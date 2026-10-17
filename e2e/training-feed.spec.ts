import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { ANNOTATIONS_FILE, SFT_REVIEW_FILE } from "./paths";

// Answers approved on the real predictions page feed the fine-tuning file, and every row there carries
// a kind. Against a copy of e2e/fixtures/examples.jsonl; no model and no network.

type Row = { messages: { content: string }[]; meta: { id: string; status: string; action: string; kind?: string; trainOnly?: boolean; source: string } };

async function rows(): Promise<Row[]> {
  return (await readFile(SFT_REVIEW_FILE, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Row);
}

test.beforeEach(async ({ page }) => {
  await rm(ANNOTATIONS_FILE, { force: true });
  await rm(SFT_REVIEW_FILE, { force: true });
  await mkdir(path.dirname(SFT_REVIEW_FILE), { recursive: true });
  await copyFile("e2e/fixtures/examples.jsonl", SFT_REVIEW_FILE);
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
  await expect(page.getByTestId("training-status")).toHaveText("Already in the fine-tuning data");
  expect(await rows()).toHaveLength(before);

  await square(page, 5).click();
  await expect(page.locator("[data-accept]")).toBeEnabled();
  await page.keyboard.press("y");
  await expect(page.getByTestId("training-status")).toContainText("Added to the fine-tuning data");
  await square(page, 5).click();
  await expect(page.locator("[data-accept]")).toBeEnabled();
  await page.keyboard.press("y");
  await expect(page.getByTestId("training-status")).toHaveText("Already in the fine-tuning data");
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
