/**
 * The examples file's life cycle on the real data: add, review (approve, correct, reject, undo), and
 * what reaches training. The annotate page and `npm run sft:build` both go through these functions.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { datasetFromReviews } from "@/lib/annotate/dataset";
import { buildSplits } from "./build";
import type { LabeledExample } from "./batch";
import { addExamples, applyReview, messageKey, parseExamples, reviewOf, serializeExamples } from "./examples";

// Review state changes as people work through the file, so these tests start every row from pending.
const rows = parseExamples(readFileSync("data/sft/examples.jsonl", "utf8")).map((r) => ({ ...r, meta: { ...r.meta, status: "pending" as const } }));
const row = (message: string) => rows.find((r) => r.messages[1].content === message)!;
const answer = (r: { messages: [unknown, unknown, { content: string }] }) => JSON.parse(r.messages[2].content);

describe("the examples file", () => {
  it("has unique ids and unique messages per action", () => {
    expect(new Set(rows.map((r) => r.meta.id)).size).toBe(rows.length);
    const keys = rows.map((r) => messageKey(r.meta.action, r.messages[1].content));
    expect(new Set(keys).size).toBe(rows.length);
  });

  it("round-trips through serialize and parse", () => {
    expect(parseExamples(serializeExamples(rows))).toEqual(rows);
  });

  const example = (message: string, fields: Record<string, string | number> = {}): LabeledExample => ({
    id: "batch-001", action: "send_etransfer", message, fields, vague: false,
  });

  it("skips a message that is already there, numbers new rows per source, and never changes existing rows", () => {
    const { records, skipped } = addExamples(rows, [{ ...example(rows[0]!.messages[1].content), action: rows[0]!.meta.action as LabeledExample["action"] }, example("send $1 to a brand new person named Zed", { recipient: "Zed", amount: 1 })], "synthetic");
    expect(skipped).toHaveLength(1);
    expect(records.slice(0, rows.length)).toEqual(rows);
    expect(records.at(-1)!.meta).toMatchObject({ id: `syn-${String(rows.filter((r) => r.meta.source === "synthetic").length + 1).padStart(4, "0")}`, source: "synthetic", status: "pending" });
  });

  it("keeps sample rows ahead of synthetic ones when more samples are added", () => {
    const { records } = addExamples(rows, [example("send $2 to Quinn", { recipient: "Quinn", amount: 2 })], "sample");
    const lastSample = records.map((r) => r.meta.source).lastIndexOf("sample");
    expect(records[lastSample]!.meta.id).toMatch(/^smp-188$/);
    expect(records.slice(0, lastSample + 1).every((r) => r.meta.source === "sample")).toBe(true);
  });
});

describe("reviewing a row", () => {
  const target = row("e-transfer $85 to Marcus for the tickets");

  it("approving as is keeps the answer and marks the row approved", () => {
    const approved = applyReview(target, { expectedAction: "send_etransfer", expectedParams: { recipient: "Marcus", amount: "85" } });
    expect(approved.meta.status).toBe("approved");
    expect(approved.messages[2]).toEqual(target.messages[2]);
    expect(approved.meta.original).toBeUndefined();
  });

  it("a correction rewrites the answer, keeps the generator's first answer, and undo restores it", () => {
    const fixed = applyReview(target, { expectedAction: "send_etransfer", expectedParams: { recipient: "Marcus", amount: "$850", date: "tomorrow" }, note: "was 85" });
    expect(answer(fixed)).toEqual({ recipient: "Marcus", recipient_email: "", amount: 850, date: "tomorrow" });
    expect(fixed.meta).toMatchObject({ status: "approved", note: "was 85", present: ["recipient", "amount", "date"] });
    // A second correction still remembers what the generator first wrote.
    const again = applyReview(fixed, { expectedAction: "send_etransfer", expectedParams: { recipient: "Marcus", amount: "86" } });
    expect(JSON.parse(again.meta.original!.answer)).toEqual(answer(target));
    expect(applyReview(again, null)).toEqual({ ...target, meta: { ...target.meta, note: undefined, reviewedBy: undefined } });
  });

  it("changing the action rebuilds the prompt and the field list for that action", () => {
    const moved = applyReview(target, { expectedAction: "request_etransfer", expectedParams: { from_person: "Marcus", amount: "85" } });
    expect(moved.meta.action).toBe("request_etransfer");
    expect(Object.keys(answer(moved))).toEqual(["from_person", "from_email", "amount"]);
    expect(moved.messages[0].content).toContain("from_person, from_email, amount");
    expect(applyReview(moved, null).meta.action).toBe("send_etransfer");
  });

  it("choosing none rejects the row, and a bad amount is refused", () => {
    expect(applyReview(target, { expectedAction: "none", expectedParams: {} }).meta.status).toBe("rejected");
    expect(() => applyReview(target, { expectedAction: "send_etransfer", expectedParams: { amount: "lots" } })).toThrow(/isn't an amount/);
  });

  it("reviewOf reads a row's state back in the annotate page's terms", () => {
    expect(reviewOf(target)).toBeNull();
    const fixed = applyReview(target, { expectedAction: "send_etransfer", expectedParams: { recipient: "Marcus", amount: "850" } });
    expect(reviewOf(fixed)).toMatchObject({ expectedAction: "send_etransfer", expectedParams: { recipient: "Marcus", amount: "850" } });
    expect(reviewOf(applyReview(target, { expectedAction: "none", expectedParams: {} }))?.expectedAction).toBe("none");
  });
});

describe("what the annotate page sees", () => {
  it("shows the generator's answer and the saved review, even after a correction", () => {
    const target = row("e-transfer $85 to Marcus for the tickets");
    const fixed = applyReview(target, { expectedAction: "send_etransfer", expectedParams: { recipient: "Marcus", amount: "850" } });
    const { predictions, annotations } = datasetFromReviews(rows.map((r) => (r === target ? fixed : r)));
    const shown = predictions.find((p) => p.message === target.messages[1].content)!;
    expect(shown.params.amount!.value).toBe("85");
    expect(annotations[shown.id]!.expectedParams.amount).toBe("850");
    expect(Object.keys(annotations)).toEqual([shown.id]);
  });
});

describe("training", () => {
  const approve = (r: (typeof rows)[number]) =>
    applyReview(r, { expectedAction: r.meta.action, expectedParams: Object.fromEntries(Object.entries(JSON.parse(r.messages[2].content) as Record<string, string | number>).filter(([, v]) => v !== "" && v !== 0).map(([k, v]) => [k, String(v)])) });

  it("only approved rows reach the training files", () => {
    expect(Object.values(buildSplits(rows).files).flat()).toEqual([]);
    const syn = approve(row("e-transfer $85 to Marcus for the tickets"));
    const rejected = applyReview(row("send 30 bucks to lena"), { expectedAction: "none", expectedParams: {} });
    const { files } = buildSplits([syn, rejected]);
    expect(files.train.map((r) => r.meta.id)).toEqual([syn.meta.id]);
    expect(files.val).toEqual([]);
    expect(files.test).toEqual([]);
  });

  it("splits approved sample rows by id, and sends synthetic rows to train only", () => {
    const samples = rows.filter((r) => r.meta.source === "sample").map(approve);
    const { files } = buildSplits([...samples, approve(row("send 30 bucks to lena"))]);
    expect(files.val.length).toBeGreaterThan(0);
    expect(files.test.length).toBeGreaterThan(0);
    expect([...files.val, ...files.test].every((r) => r.meta.source === "sample")).toBe(true);
    expect(files.train.some((r) => r.meta.source === "synthetic")).toBe(true);
  });

  it("drops an approved synthetic row that repeats a held-out message", () => {
    const samples = rows.filter((r) => r.meta.source === "sample").map(approve);
    const heldOut = buildSplits(samples).files.test[0]!;
    const copy = { ...approve(row("send 30 bucks to lena")), messages: heldOut.messages, meta: { ...heldOut.meta, source: "synthetic" as const, status: "approved" as const, id: "syn-9999" } };
    expect(buildSplits([...samples, copy]).dropped).toEqual(["syn-9999"]);
  });
});
