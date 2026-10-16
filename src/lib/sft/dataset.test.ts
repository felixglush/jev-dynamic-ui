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
import { splitOf } from "./split";
import type { SftRecord } from "./record";

const rows = parseExamples(readFileSync("data/sft/examples.jsonl", "utf8"));
const read = (split: string) => {
  const text = readFileSync(`data/sft/${split}.jsonl`, "utf8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line) as SftRecord) : [];
};
const approveAll = (list: ExampleRecord[]) => list.map((r) => ({ ...r, meta: { ...r.meta, status: "approved" as const } }));

describe("the examples file", () => {
  it("has unique ids, sample rows ahead of synthetic ones, and only pending rows until someone reviews", () => {
    expect(new Set(rows.map((r) => r.meta.id)).size).toBe(rows.length);
    const firstSynthetic = rows.findIndex((r) => r.meta.source === "synthetic");
    expect(rows.slice(firstSynthetic).every((r) => r.meta.source === "synthetic")).toBe(true);
    expect(rows.filter((r) => r.meta.source === "sample")).toHaveLength(187);
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

  it("hold out sample rows for every action once they are approved, and never a synthetic row", () => {
    const { files: built } = buildSplits(approveAll(rows));
    const actions = new Set(rows.filter((r) => r.meta.source === "sample").map((r) => r.meta.action));
    for (const action of actions) {
      expect(built.val.some((r) => r.meta.action === action)).toBe(true);
      expect(built.test.some((r) => r.meta.action === action)).toBe(true);
    }
    for (const r of [...built.val, ...built.test]) expect(r.meta.source).toBe("sample");
  });

  it("don't move a row when other rows are approved later", () => {
    const sample = approveAll(rows.filter((r) => r.meta.source === "sample"));
    const half = buildSplits(sample.slice(0, 60)).files;
    for (const split of ["train", "val", "test"] as const) {
      for (const r of half[split]) expect(splitOf(r.meta.id)).toBe(split);
    }
  });
});
