/**
 * Checks on the real seed file and the real extractor, not on mocks: the committed training files
 * must match what the build produces, the training prompt must be the extractor's prompt, labels
 * must be well-formed, and no message may sit in two splits.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { schemaFor, systemPromptFor } from "@/lib/extract/ollama";
import { toRecord, type SftRecord } from "./record";
import { parseSeed, validateExamples } from "./seed";
import { splitIds } from "./split";

const examples = parseSeed(readFileSync("data/sft/seed-labeled.txt", "utf8"));
const read = (split: string) =>
  readFileSync(`data/sft/${split}.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line) as SftRecord);

describe("seed set", () => {
  it("has well-formed labels: known fields of the action, positive amounts, no empty strings", () => {
    expect(validateExamples(examples)).toEqual([]);
  });

  it("catches a field the action doesn't have", () => {
    const bad = [{ ...examples[0]!, fields: { nickname: "Nobody" } }];
    expect(validateExamples(bad)[0]).toContain("not a free-text field");
  });
});

describe("records", () => {
  it("use the extractor's system prompt and answer with every schema field, blanks included", () => {
    for (const example of examples) {
      const [system, user, assistant] = toRecord(example).messages;
      expect(system.content).toBe(systemPromptFor(example.action));
      expect(user.content).toBe(example.message);
      const answer = JSON.parse(assistant.content) as Record<string, unknown>;
      expect(Object.keys(answer)).toEqual(Object.keys(schemaFor(example.action).properties));
    }
  });

  it("leave fields the message doesn't state blank (empty string, 0 for amounts)", () => {
    const record = toRecord(examples.find((e) => e.message === "transfer $300 to priya.k@example.com")!);
    expect(JSON.parse(record.messages[2].content)).toEqual({
      recipient: "",
      recipient_email: "priya.k@example.com",
      amount: 300,
      date: "",
    });
  });
});

describe("split", () => {
  const files = Object.fromEntries(["train", "val", "test"].map((s) => [s, read(s)]));

  it("matches what `npm run sft:build` would write", () => {
    const splitOf = splitIds(examples);
    for (const [split, records] of Object.entries(files)) {
      const expected = examples.filter((e) => splitOf.get(e.id) === split).map(toRecord);
      expect(records).toEqual(expected);
    }
  });

  it("never puts the same message in two splits", () => {
    const seen = new Map<string, string>();
    for (const [split, records] of Object.entries(files)) {
      for (const r of records) {
        const key = `${r.meta.action}|${r.messages[1].content.toLowerCase()}`;
        expect(seen.get(key) ?? split).toBe(split);
        seen.set(key, split);
      }
    }
  });

  it("holds out examples for every action", () => {
    const actions = new Set(examples.map((e) => e.action));
    for (const action of actions) {
      expect(files.val!.some((r) => r.meta.action === action)).toBe(true);
      expect(files.test!.some((r) => r.meta.action === action)).toBe(true);
    }
  });
});
