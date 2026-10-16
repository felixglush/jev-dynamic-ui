import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { SFT_REVIEW_FILE } from "./paths";

// Reviewing the generated fine-tuning rows on /annotate, against a copy of data/sft/examples.jsonl
// that the app writes into. No model and no network: this is the file round trip.

type Row = { messages: { content: string }[]; meta: { id: string; status: string; action: string; original?: { answer: string }; note?: string } };

async function rows(): Promise<Row[]> {
  return (await readFile(SFT_REVIEW_FILE, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Row);
}

async function open(page: Page) {
  await page.goto("/annotate");
  await expect(page.locator("[data-interactive]")).toBeVisible();
  await page.getByRole("button", { name: "Fine-tuning data" }).click();
  await expect(page.getByRole("heading", { name: "Review the fine-tuning data" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await rm(SFT_REVIEW_FILE, { force: true });
  await mkdir(path.dirname(SFT_REVIEW_FILE), { recursive: true });
  await copyFile("data/sft/examples.jsonl", SFT_REVIEW_FILE);
  await open(page);
});

test.afterEach(async ({ page }) => {
  await expect(page.getByTestId("file-status")).not.toContainText("Saving");
});

test("opens on Fields only with the generated row, blanks marked", async ({ page }) => {
  await expect(page.getByText("Extractor output")).toBeVisible();
  await expect(page.getByTestId("predicted-action")).toHaveText("send_etransfer");
  await expect(page.getByText("blank").first()).toBeVisible(); // recipient_email and date are blank
  await expect(page.getByTestId("progress")).toHaveText(/^0 of \d+ reviewed$/);
});

test("Y approves the row in the file, with its answer unchanged", async ({ page }) => {
  await page.keyboard.press("y");
  await expect(page.getByTestId("file-status")).toHaveText(`Saved to ${SFT_REVIEW_FILE}`);
  const [first, second] = await rows();
  expect(first!.meta).toMatchObject({ id: "smp-001", status: "approved" });
  expect(first!.meta.original).toBeUndefined();
  expect(second!.meta.status).toBe("pending");
});

test("a correction is written into the row and the generator's answer is kept", async ({ page }) => {
  await page.keyboard.press("n");
  await page.getByLabel("amount", { exact: true }).fill("850");
  await page.getByLabel("date", { exact: true }).fill("tomorrow");
  await page.getByLabel("Note (optional)").fill("amount was wrong");
  await page.getByLabel("Note (optional)").press("Enter");
  await expect(page.getByTestId("file-status")).toHaveText(`Saved to ${SFT_REVIEW_FILE}`);

  const [first] = await rows();
  expect(JSON.parse(first!.messages[2]!.content)).toEqual({ recipient: "Sam", recipient_email: "", amount: 850, date: "tomorrow" });
  expect(JSON.parse(first!.meta.original!.answer).amount).toBe(50);
  expect(first!.meta).toMatchObject({ status: "approved", note: "amount was wrong" });

  // A fresh page load reads the review back from the file.
  await open(page);
  await expect(page.getByTestId("progress")).toHaveText(/^1 of \d+ reviewed$/);
  await expect(page.getByRole("navigation", { name: "Messages" }).getByRole("button").first()).toHaveAccessibleName("Message 1, wrong values");
});

test("choosing none rejects the row so it never trains", async ({ page }) => {
  await page.keyboard.press("n");
  await page.getByLabel("Action", { exact: true }).selectOption("none");
  await page.getByLabel("Action", { exact: true }).press("Enter");
  await expect(page.getByTestId("file-status")).toHaveText(`Saved to ${SFT_REVIEW_FILE}`);
  expect((await rows())[0]!.meta.status).toBe("rejected");
});

test("Clear all takes every review back", async ({ page }) => {
  await page.keyboard.press("y");
  await expect(page.getByTestId("file-status")).toHaveText(`Saved to ${SFT_REVIEW_FILE}`);
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.getByRole("button", { name: "Click again to clear every answer" }).click();
  await expect(page.getByTestId("progress")).toHaveText(/^0 of/);
  await expect(page.getByTestId("file-status")).toHaveText(`Saved to ${SFT_REVIEW_FILE}`);
  expect((await rows()).every((r) => r.meta.status === "pending")).toBe(true);
});

test("the Group menu walks one group at a time and shows its progress", async ({ page }) => {
  const group = page.getByRole("combobox", { name: "Group" });
  await group.selectOption("send_etransfer");
  await expect(page.getByTestId("predicted-action")).toHaveText("send_etransfer");
  await expect(page.getByText(/Message 1 of \d+/)).not.toContainText("of 645");
  // Overall progress stays global.
  await expect(page.getByTestId("progress")).toHaveText(/^0 of 645 reviewed$/);
  await page.keyboard.press("y");
  await expect(group.locator("option:checked")).toHaveText(/^send etransfer \(1\//);
  await expect(page.getByTestId("progress")).toHaveText("1 of 645 reviewed");
  await group.selectOption("");
  await expect(page.getByText("Message 1 of 645")).toBeVisible();
});

test("the square grid has one labeled block per group", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Messages" });
  await expect(nav.getByRole("group", { name: "send etransfer", exact: true })).toBeVisible();
  await expect(nav.getByRole("group", { name: "send etransfer", exact: true }).getByText(/^send etransfer · 0\/\d+$/)).toBeVisible();
  await page.getByRole("combobox", { name: "Group" }).selectOption("send_etransfer");
  await expect(nav.getByRole("group")).toHaveCount(1);
});

test("the square grid scrolls and shows three groups at a time", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Messages" });
  const blocks = nav.getByRole("group");
  expect(await blocks.count()).toBeGreaterThan(3);
  const fits = async (i: number) => nav.evaluate((grid, n) => {
    const b = grid.children[n] as HTMLElement;
    return b.offsetTop - (grid as HTMLElement).offsetTop + b.offsetHeight <= grid.clientHeight + 1;
  }, i);
  expect(await fits(2)).toBe(true);
  expect(await fits(3)).toBe(false);
  expect(await nav.evaluate((g) => g.scrollHeight > g.clientHeight)).toBe(true);
});
