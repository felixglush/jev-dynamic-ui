import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { ANNOTATIONS_FILE, SFT_REVIEW_FILE } from "./paths";

// Answers approved on the real predictions page feed the fine-tuning file, and every row there carries
// a kind. Against a copy of e2e/fixtures/examples.jsonl; no model and no network.

type Row = { messages: { content: string }[]; meta: { id: string; reviewedBy?: string; status: string; action: string; kind?: string; trainOnly?: boolean; split?: string; source: string } };

async function rows(): Promise<Row[]> {
  return (await readFile(SFT_REVIEW_FILE, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Row);
}

test.beforeEach(async ({ page }) => {
  await rm(ANNOTATIONS_FILE, { force: true });
  await rm(SFT_REVIEW_FILE, { force: true });
  await mkdir(path.dirname(SFT_REVIEW_FILE), { recursive: true });
  await copyFile("e2e/fixtures/examples.jsonl", SFT_REVIEW_FILE);
  // The first three rows are approved and pinned: smp-001 ("Send $50 to Sam...", also on the predictions
  // page) to val, the next to test, the third to train. The rest stay pending.
  const lines = (await readFile(SFT_REVIEW_FILE, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Row);
  (["val", "test", "train"] as const).forEach((split, i) => Object.assign(lines[i]!.meta, { status: "approved", split, reviewedBy: i === 0 ? "human" : "claude" }));
  await writeFile(SFT_REVIEW_FILE, lines.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await page.goto("/annotate");
  await expect(page.locator("[data-interactive]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Message 1 of 100" })).toBeVisible();
  await expect(page.getByTestId("extractor-status")).toContainText("LiquidFM read");
});

test.afterEach(async ({ page }) => {
  await expect(page.getByTestId("file-status")).not.toContainText("Saving");
});

const square = (page: Page, n: number) => page.getByRole("navigation", { name: "Messages" }).getByRole("button").nth(n - 1);
const ALEX = "pay Alex 75.50 via interac";

test("approving a real prediction adds an approved, train-only row with its kind", async ({ page }) => {
  const before = (await rows()).length;
  await square(page, 5).click();
  await expect(page.locator("[data-accept]")).toBeEnabled();
  await page.getByLabel("Kind of example").selectOption("amount-format");
  await page.keyboard.press("y");
  await expect(page.getByTestId("training-status")).toContainText("Added to the fine-tuning data");

  const all = await rows();
  expect(all).toHaveLength(before + 1);
  const added = all.find((r) => r.messages[1]!.content === ALEX)!;
  expect(added.meta).toMatchObject({ status: "approved", action: "send_etransfer", kind: "amount-format", trainOnly: true, source: "sample" });
  expect(JSON.parse(added.messages[2]!.content)).toMatchObject({ recipient: "Alex", amount: 75.5 });
});

test("a message already in the fine-tuning file is not added twice", async ({ page }) => {
  const before = (await rows()).length;
  // "Send $50 to Sam for dinner last night" is row smp-001 of the fixture.
  await expect(page.locator("[data-accept]")).toBeEnabled();
  await page.keyboard.press("y");
  await expect(page.getByTestId("training-status")).toHaveText("Saved onto the row already in the fine-tuning data (smp-001, val, held out, never trained on)");
  expect(await rows()).toHaveLength(before);

  await square(page, 5).click();
  await expect(page.locator("[data-accept]")).toBeEnabled();
  await page.keyboard.press("y");
  await expect(page.getByTestId("training-status")).toContainText("Added to the fine-tuning data");
  await square(page, 5).click();
  await expect(page.locator("[data-accept]")).toBeEnabled();
  await page.keyboard.press("y");
  await expect(page.getByTestId("training-status")).toHaveText(/^Saved onto the row already in the fine-tuning data/);
  expect(await rows()).toHaveLength(before + 1);
});

test("a message Jev did not turn into an action is not added", async ({ page }) => {
  const before = (await rows()).length;
  await page.keyboard.press("n");
  await page.getByLabel("Action", { exact: true }).selectOption("none");
  await page.getByLabel("Action", { exact: true }).press("Enter");
  await expect(page.getByTestId("file-status")).toHaveText(/^Saved to/);
  await expect(page.getByTestId("training-status")).toHaveCount(0);
  expect(await rows()).toHaveLength(before);
});

test("the fine-tuning view filters by kind and a kind change is written to the row", async ({ page }) => {
  await page.getByRole("button", { name: "Fine-tuning data" }).click();
  await expect(page.getByRole("heading", { name: "Review the fine-tuning data" })).toBeVisible();

  const kind = page.getByRole("combobox", { name: "Kind", exact: true });
  const options = await kind.locator("option").allTextContents();
  expect(options.length).toBeGreaterThan(2); // "All kinds" plus the kinds present in the file
  await kind.selectOption({ index: 1 });
  await expect(page.getByText(/Message 1 of \d+/)).not.toContainText("of 48");
  await kind.selectOption("");
  await expect(page.getByText("Message 1 of 48")).toBeVisible();

  await page.getByLabel("Kind of example").selectOption("accented-name");
  await page.keyboard.press("y");
  await expect(page.getByTestId("file-status")).toHaveText(`Saved to ${SFT_REVIEW_FILE}`);
  expect((await rows())[0]!.meta).toMatchObject({ status: "approved", kind: "accented-name" });
});

test("a message held out in val is flagged and can never be added to train", async ({ page }) => {
  // Message 1 is smp-001, pinned to val in beforeEach.
  await expect(page.getByTestId("split-badge")).toHaveText("val: held out, never trained on");
  const before = (await rows()).length;
  await expect(page.locator("[data-accept]")).toBeEnabled();
  await page.keyboard.press("y");
  await expect(page.getByTestId("training-status")).toContainText("val, held out, never trained on");
  expect(await rows()).toHaveLength(before);
  expect((await rows())[0]!.meta).toMatchObject({ split: "val", status: "approved" });

  // A message that is in no file gets no badge.
  await square(page, 5).click();
  await expect(page.getByTestId("split-badge")).toHaveCount(0);
});

test("the Split menu filters both tabs to train, val or test", async ({ page }) => {
  const split = page.getByRole("combobox", { name: "Split" });
  await expect(split.locator("option")).toHaveText(["All splits (100)", "train (0/1)", "val (0/1)", "test (0/1)", "pending (0/15)"]);
  await split.selectOption("val");
  await expect(page.getByText(/Message 1 of 1$/)).toBeVisible();
  await expect(page.getByTestId("split-badge")).toHaveText("val: held out, never trained on");

  await page.getByRole("button", { name: "Fine-tuning data" }).click();
  const sft = page.getByRole("combobox", { name: "Split" });
  await expect(sft.locator("option")).toHaveText(["All splits (48)", "train (1/1)", "val (1/1)", "test (1/1)"]);
  await sft.selectOption("test");
  await expect(page.getByText(/Message 1 of 1$/)).toBeVisible();
  await expect(page.getByTestId("split-badge")).toHaveText("test: held out, never trained on");
});

test("the Reviewer menu separates rows you reviewed from rows Claude approved", async ({ page }) => {
  await page.getByRole("button", { name: "Fine-tuning data" }).click();
  const reviewer = page.getByRole("combobox", { name: "Reviewer", exact: true });
  await expect(reviewer.locator("option")).toHaveText(["All reviewers", "Reviewed by you (1)", "Approved by Claude (2)"]);
  await reviewer.selectOption("human");
  await expect(page.getByText("Message 1 of 1")).toBeVisible();
  await expect(page.getByTestId("reviewer-badge")).toHaveText("reviewed by you");
  await reviewer.selectOption("claude");
  await expect(page.getByText("Message 1 of 2")).toBeVisible();
  await expect(page.getByTestId("reviewer-badge")).toHaveText("approved by Claude");
});
