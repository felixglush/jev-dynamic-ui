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
import { groupOf, MIN_GROUP_SIZE, pinnedSplit, stratifiedSplit } from "./split";
import type { SftRecord } from "./record";

const rows = parseExamples(readFileSync("data/sft/examples.jsonl", "utf8"));
const read = (split: string) => {
  const text = readFileSync(`data/sft/${split}.jsonl`, "utf8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line) as SftRecord) : [];
};
// The hash split only decides the rows that are not pinned; pinned rows (v2 and later) are placed by hand.
const hashRows = rows.filter((r) => !pinnedSplit(r.meta) && !r.meta.version);
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
    const { files: built } = buildSplits(approveAll(hashRows));
    const sizes = new Map<string, number>();
    for (const r of hashRows) sizes.set(groupOf(r.meta), (sizes.get(groupOf(r.meta)) ?? 0) + 1);
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
    const { files: built } = buildSplits(approveAll(hashRows));
    for (const group of new Set(hashRows.map((r) => groupOf(r.meta)))) {
      const total = hashRows.filter((r) => groupOf(r.meta) === group).length;
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

describe("pinned rows (meta.split) and versions", () => {
  const approved = approveAll(rows);
  const stripped = (list: SftRecord[]) => list.map((r) => ({ id: r.meta.id, messages: r.messages }));
  const synthetic = (id: string, message: string, extra: Record<string, unknown> = {}) =>
    ({ ...approved[0]!, messages: [approved[0]!.messages[0], { role: "user" as const, content: message }, approved[0]!.messages[2]], meta: { ...approved[0]!.meta, id, ...extra } }) as ExampleRecord;

  it.each(["v1", "v2", "v3", "v4", "v5"] as const)("rebuild the %s sets exactly as frozen in data/sft/%s/", (version) => {
    const { files: built } = buildSplits(rows, { version });
    for (const split of ["train", "val", "test"] as const) {
      const frozen = readFileSync(`data/sft/${version}/${split}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l) as SftRecord);
      expect(stripped(built[split]), `${version} ${split}`).toEqual(stripped(frozen));
    }
  });

  it("drop a retired row from its version on, and keep it in the older versions", () => {
    const retired = rows.filter((r) => r.meta.retired);
    expect(retired.length).toBeGreaterThan(0);
    const ids = (version: "v1" | "v2" | "v3" | "v4" | "v5") => new Set(Object.values(buildSplits(rows, { version }).files).flat().map((r) => r.meta.id));
    for (const r of retired) {
      expect(ids("v3").has(r.meta.id), r.meta.id).toBe(false);
      expect(ids("v2").has(r.meta.id) || ids("v1").has(r.meta.id), r.meta.id).toBe(true);
    }
  });

  it("send a pinned row to its split and leave every hash-split row where it was", () => {
    const base = buildSplits(approved).files;
    const extra = [synthetic("pin-val", "pinned val message", { split: "val" }), synthetic("pin-test", "pinned test message", { split: "test" }), synthetic("pin-train", "pinned train message", { split: "train" })];
    const more = buildSplits([...approved, ...extra]).files;
    const ids = (list: SftRecord[]) => list.map((r) => r.meta.id);
    expect(ids(more.val)).toEqual([...ids(base.val), "pin-val"]);
    expect(ids(more.test)).toEqual([...ids(base.test), "pin-test"]);
    expect(ids(more.train)).toEqual([...ids(base.train), "pin-train"]);
  });

  it("still honour trainOnly, and let meta.split win over it", () => {
    const files = buildSplits([...approved, synthetic("old", "old train-only message", { trainOnly: true }), synthetic("both", "split beats trainOnly", { trainOnly: true, split: "val" })]).files;
    expect(files.train.some((r) => r.meta.id === "old")).toBe(true);
    expect(files.val.some((r) => r.meta.id === "both")).toBe(true);
  });

  it("only pin v2 and later rows, and use known pattern names", () => {
    const pinned = rows.filter((r) => r.meta.split);
    expect(pinned.every((r) => r.meta.version === "v2" || r.meta.version === "v3" || r.meta.version === "v4" || r.meta.version === "v5")).toBe(true);
    const patterns = new Set(["spelled-amount", "company-name", "email-no-name", "past-event-date", "lowercase-name", "today-date", "cancel-email-only", "amount-format", "two-amounts", "accented-name", "phone-account", "relationship-blank", "date-format", "typos-slang", "vague-empty", "plain", "name-shape", "phone-no-email", "email-shape", "amount-separators", "self-correction", "negation", "typo-field", "injection", "placeholder-empty", "worded-number", "amount-not-stated", "multi-entity", "junk-input", "date-edge", "odd-name", "phone-ext"]);
    for (const r of rows) if (r.meta.pattern) expect(patterns.has(r.meta.pattern), r.meta.id).toBe(true);
  });
});

describe("contamination", () => {
  it("never trains on a message that sits in val or test, for any version and under any action", async () => {
    const { VERSIONS } = await import("./build");
    const { normalizeMessage } = await import("./examples");
    for (const version of VERSIONS) {
      const { files } = buildSplits(rows, { version });
      const heldOut = new Set([...files.val, ...files.test].map((r) => normalizeMessage(r.messages[1].content)));
      const leaked = files.train.filter((r) => heldOut.has(normalizeMessage(r.messages[1].content)));
      expect(leaked.map((r) => r.meta.id), version).toEqual([]);
    }
  });
});
