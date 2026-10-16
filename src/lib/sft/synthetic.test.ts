/**
 * The synthetic file's life cycle on the real data: add, review (approve, correct, reject, undo), and
 * what reaches training. The annotate page and `npm run sft:build` both go through these functions.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { datasetFromReviews } from "@/lib/annotate/dataset";
import { buildSplits } from "./build";
import { parseSeed } from "./seed";
import { addExamples, applyReview, messageKey, parseSynthetic, reviewOf, serializeSynthetic } from "./synthetic";

const seed = parseSeed(readFileSync("data/sft/seed-labeled.txt", "utf8"));
const rows = parseSynthetic(readFileSync("data/sft/synthetic.jsonl", "utf8"));
const row = (message: string) => rows.find((r) => r.messages[1].content === message)!;
const answer = (r: { messages: [unknown, unknown, { content: string }] }) => JSON.parse(r.messages[2].content);

describe("the synthetic file", () => {
  it("has unique ids and messages, none of them in the seed set", () => {
    expect(new Set(rows.map((r) => r.meta.id)).size).toBe(rows.length);
    const keys = rows.map((r) => messageKey(r.meta.action, r.messages[1].content));
    expect(new Set(keys).size).toBe(rows.length);
    const seedKeys = new Set(seed.map((e) => messageKey(e.action, e.message)));
    expect(keys.filter((k) => seedKeys.has(k))).toEqual([]);
  });

  it("round-trips through serialize and parse", () => {
    expect(parseSynthetic(serializeSynthetic(rows))).toEqual(rows);
  });

  it("skips a message that is already there and never changes existing rows", () => {
    const example = { ...seed[0]!, message: rows[0]!.messages[1].content, action: rows[0]!.meta.action as typeof seed[0]["action"] };
    const fresh = { ...seed[0]!, message: "send $1 to a brand new person named Zed", fields: { recipient: "Zed", amount: 1 } };
    const { records, skipped } = addExamples(rows, [example, fresh], new Set());
    expect(skipped).toHaveLength(1);
    expect(records.slice(0, rows.length)).toEqual(rows);
    expect(records.at(-1)!.meta).toMatchObject({ id: `syn-${String(rows.length + 1).padStart(4, "0")}`, status: "pending" });
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
    expect(applyReview(again, null)).toEqual({ ...target, meta: { ...target.meta, note: undefined } });
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
  it("only approved rows reach train, and never val or test", () => {
    const target = row("e-transfer $85 to Marcus for the tickets");
    const approved = [applyReview(target, { expectedAction: "send_etransfer", expectedParams: { recipient: "Marcus", amount: "85" } }), applyReview(row("send 30 bucks to lena"), { expectedAction: "none", expectedParams: {} })];
    const before = buildSplits(seed, rows).files;
    const after = buildSplits(seed, approved).files;
    expect(before.train.some((r) => r.meta.source === "synthetic")).toBe(false);
    expect(after.train.filter((r) => r.meta.source === "synthetic").map((r) => r.meta.id)).toEqual([target.meta.id]);
    expect(after.val).toEqual(before.val);
    expect(after.test).toEqual(before.test);
  });

  it("drops an approved row that repeats a held-out message", () => {
    const { files } = buildSplits(seed, []);
    const heldOut = files.test[0]!;
    const copy = { ...row("e-transfer $85 to Marcus for the tickets"), messages: heldOut.messages, meta: { ...heldOut.meta, source: "synthetic" as const, status: "approved" as const, id: "syn-9999" } };
    expect(buildSplits(seed, [copy]).dropped).toEqual(["syn-9999"]);
  });
});
