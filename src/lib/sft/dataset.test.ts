/**
 * Checks on the real examples file and the real extractor, not on mocks: every row uses the
 * extractor's prompt and field list, the committed train/val/test match what `npm run sft:build`
 * produces, and the held-out sets stay unseen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { schemaFor, systemPromptFor } from "@/lib/extract/ollama";
import { buildSplits } from "./build";
import { parseExamples, type ExampleRecord } from "./examples";
import { groupOf, MIN_GROUP_SIZE, stratifiedSplit } from "./split";
import type { SftRecord } from "./record";

const rows = parseExamples(readFileSync("data/sft/examples.jsonl", "utf8"));
const read = (split: string) => {
  const text = readFileSync(`data/sft/${split}.jsonl`, "utf8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line) as SftRecord) : [];
};
const approveAll = (list: ExampleRecord[]) => list.map((r) => ({ ...r, meta: { ...r.meta, status: "approved" as const } }));

describe("the examples file", () => {
  it("has unique ids and a review status on every row", () => {
    expect(new Set(rows.map((r) => r.meta.id)).size).toBe(rows.length);
    expect(rows.every((r) => ["pending", "approved", "rejected"].includes(r.meta.status))).toBe(true);
  });

  it("gives every row the extractor's system prompt and an answer with every field, in schema order", () => {
    for (const row of rows) {
      const [system, user, assistant] = row.messages;
      const action = row.meta.action as keyof typeof import("@/lib/jev/catalog").CATALOG;
      expect(system.content).toBe(systemPromptFor(action));
      expect(user.content.length).toBeGreaterThan(0);
      const answer = JSON.parse(assistant.content) as Record<string, unknown>;
      expect(Object.keys(answer)).toEqual(Object.keys(schemaFor(action).properties));
      // `present` lists exactly the fields with a value.
      expect(row.meta.present).toEqual(Object.keys(answer).filter((name) => answer[name] !== "" && answer[name] !== 0));
    }
  });

  it("leaves fields the message doesn't state blank (empty string, 0 for amounts)", () => {
    const row = rows.find((r) => r.messages[1].content === "transfer $300 to priya.k@example.com")!;
    expect(JSON.parse(row.messages[2].content)).toEqual({ recipient: "", recipient_email: "priya.k@example.com", amount: 300, date: "" });
  });
});

describe("train, val and test", () => {
  const files = Object.fromEntries(["train", "val", "test"].map((s) => [s, read(s)]));

  it("match what `npm run sft:build` would write", () => {
    const { files: built } = buildSplits(rows);
    for (const [split, records] of Object.entries(files)) expect(records).toEqual(built[split as keyof typeof built]);
  });

  it("never put the same message in two splits", () => {
    const everything = approveAll(rows);
    const { files: built } = buildSplits(everything);
    const seen = new Map<string, string>();
    for (const [split, records] of Object.entries(built)) {
      for (const r of records) {
        const key = `${r.meta.action}|${r.messages[1].content.toLowerCase()}`;
        expect(seen.get(key) ?? split).toBe(split);
        seen.set(key, split);
      }
    }
  });

  it("hold out rows for every group big enough, whatever their source", () => {
    const { files: built } = buildSplits(approveAll(rows));
    const sizes = new Map<string, number>();
    for (const r of rows) sizes.set(groupOf(r.meta), (sizes.get(groupOf(r.meta)) ?? 0) + 1);
    for (const [group, size] of sizes) {
      const inSplit = (list: SftRecord[]) => list.filter((r) => groupOf(r.meta) === group).length;
      if (size >= MIN_GROUP_SIZE) {
        expect(inSplit(built.val), group).toBeGreaterThan(0);
        expect(inSplit(built.test), group).toBeGreaterThan(0);
      }
    }
    // Synthetic rows are held out too: nothing about a row's source decides its split.
    expect([...built.val, ...built.test].some((r) => r.meta.source === "synthetic")).toBe(true);
  });

  it("keep each group's val and test share close to the target (15% each)", () => {
    const { files: built } = buildSplits(approveAll(rows));
    for (const group of new Set(rows.map((r) => groupOf(r.meta)))) {
      const total = rows.filter((r) => groupOf(r.meta) === group).length;
      if (total < 20) continue;
      const share = built.test.filter((r) => groupOf(r.meta) === group).length / total;
      expect(share, group).toBeGreaterThan(0.08);
      expect(share, group).toBeLessThan(0.22);
    }
  });
});

describe("stratifiedSplit", () => {
  const make = (group: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${group}-${i}`, group }));

  it("holds out each big group separately and keeps tiny groups in train", () => {
    const result = stratifiedSplit([...make("a", 20), ...make("b", 10), ...make("c", MIN_GROUP_SIZE - 1)]);
    const count = (group: string, split: string) => [...result].filter(([id, s]) => id.startsWith(`${group}-`) && s === split).length;
    expect([count("a", "test"), count("a", "val"), count("a", "train")]).toEqual([3, 3, 14]);
    expect([count("b", "test"), count("b", "val"), count("b", "train")]).toEqual([2, 2, 6]);
    expect(count("c", "train")).toBe(MIN_GROUP_SIZE - 1);
  });

  it("gives the same answer whatever order the rows come in", () => {
    const rows = [...make("a", 12), ...make("b", 9)];
    const reversed = stratifiedSplit([...rows].reverse());
    for (const [id, split] of stratifiedSplit(rows)) expect(reversed.get(id)).toBe(split);
  });
});

describe("train-only rows", () => {
  it("never change val or test, so a model scored earlier stays comparable", () => {
    const approved = approveAll(rows);
    const without = buildSplits(approved.filter((r) => !r.meta.trainOnly));
    const withAll = buildSplits(approved);
    expect(withAll.files.val).toEqual(without.files.val);
    expect(withAll.files.test).toEqual(without.files.test);
    const trainOnly = approved.filter((r) => r.meta.trainOnly).map((r) => r.meta.id);
    expect(trainOnly.length).toBeGreaterThan(0);
    const heldOut = new Set([...withAll.files.val, ...withAll.files.test].map((r) => r.meta.id));
    expect(trainOnly.some((id) => heldOut.has(id))).toBe(false);
  });
});
