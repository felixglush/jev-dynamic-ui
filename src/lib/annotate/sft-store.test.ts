import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";
import { applyReview, parseExamples, serializeExamples } from "@/lib/sft/examples";
import { addApprovedExample } from "./sft-store";

let file: string;
beforeEach(async () => {
  file = path.join(await mkdtemp(path.join(tmpdir(), "sft-store-")), "examples.jsonl");
  process.env.SFT_REVIEW_FILE = file;
});

const rows = async () => (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

describe("addApprovedExample", () => {
  it("creates the file and adds an approved, train-only row with its kind", async () => {
    const result = await addApprovedExample({ action: "send_etransfer", message: "pay Alex 75.50 via interac", params: { recipient: "Alex", amount: "75.50" }, kind: "amount-format", note: "" });
    expect(result).toMatchObject({ id: expect.stringMatching(/^smp-/) });
    const [row] = await rows();
    expect(row.meta).toMatchObject({ status: "approved", source: "sample", trainOnly: true, kind: "amount-format", action: "send_etransfer" });
    expect(JSON.parse(row.messages[2].content)).toEqual({ recipient: "Alex", recipient_email: "", amount: 75.5, date: "" });
  });

  it("puts a review on the row that is already there instead of adding a copy, and skips actions with only choice fields", async () => {
    const row = { action: "send_etransfer", message: "pay Alex 75.50 via interac", params: { recipient: "Alex" }, kind: "plain", note: "" };
    const added = await addApprovedExample(row);
    expect(await addApprovedExample({ ...row, params: { recipient: "Alex", amount: "75.50" }, message: "  Pay Alex 75.50 via  interac " })).toEqual({ ...added, updated: true, split: "train" });
    expect(JSON.parse((await rows())[0]!.messages[2].content)).toMatchObject({ recipient: "Alex", amount: 75.5 });
    expect(await addApprovedExample({ action: "view_account", message: "show my chequing", params: {}, kind: "plain", note: "" })).toEqual({ skipped: "no-fields" });
    expect(await rows()).toHaveLength(1);
  });

  it("rejects unknown actions and kinds", async () => {
    await expect(addApprovedExample({ action: "wire_money", message: "x", params: {}, kind: "plain" })).rejects.toThrow(/Unknown action/);
    await expect(addApprovedExample({ action: "send_etransfer", message: "x", params: {}, kind: "nope" })).rejects.toThrow(/Unknown kind/);
  });

  it("approves a pending row by pinning it to train, so no other row's split moves", async () => {
    await addApprovedExample({ action: "send_etransfer", message: "pay Alex 75.50 via interac", params: { recipient: "Alex" }, kind: "plain", note: "" });
    const [first] = parseExamples(await readFile(file, "utf8"));
    const pending = applyReview(first!, null);
    await writeFile(file, serializeExamples([{ ...pending, meta: { ...pending.meta, trainOnly: undefined } }]));
    const result = await addApprovedExample({ action: "send_etransfer", message: "pay Alex 75.50 via interac", params: { recipient: "Alex" }, kind: "plain", note: "" });
    expect(result).toMatchObject({ updated: true });
    expect((await rows())[0]!.meta).toMatchObject({ status: "approved", trainOnly: true });
  });
});
