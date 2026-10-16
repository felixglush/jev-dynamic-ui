import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

// These run against the real predictions.csv at the project root (43 messages from the first live
// Jev run), served by the production build. No Jev calls are made on this page.

const square = (page: Page, n: number) => page.getByRole("navigation", { name: "Messages" }).getByRole("button").nth(n - 1);

test.beforeEach(async ({ page }) => {
  await page.goto("/annotate");
  await expect(page.getByRole("heading", { name: "Message 1 of 43" })).toBeVisible();
});

test("renders the first prediction on the server", async ({ request }) => {
  // React separates adjacent text with <!-- --> markers in its HTML; drop them before matching.
  const html = (await (await request.get("/annotate")).text()).replaceAll("<!-- -->", "");
  expect(html).toContain("Send $50 to Sam for dinner last night");
  expect(html).toContain("0 of 43 reviewed");
});

test("Y marks a prediction correct and moves to the next message", async ({ page }) => {
  await page.keyboard.press("y");

  await expect(page.getByRole("heading", { name: "Message 2 of 43" })).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("1 of 43 reviewed");
  await expect(square(page, 1)).toHaveAccessibleName("Message 1, correct");
});

test("fixing a value marks the prediction as wrong values", async ({ page }) => {
  await square(page, 3).click(); // "can you etransfer my landlord $1,850 for rent from chequing"
  await expect(page.getByLabel("recipient", { exact: true })).toHaveValue("my landlord");

  await page.keyboard.press("n");
  await expect(page.getByLabel("Action", { exact: true })).toBeFocused();
  await page.getByLabel("recipient", { exact: true }).fill("landlord");
  await page.getByLabel("recipient", { exact: true }).press("Enter");

  await expect(page.getByRole("heading", { name: "Message 4 of 43" })).toBeVisible();
  await expect(square(page, 3)).toHaveAccessibleName("Message 3, wrong values");

  await page.getByRole("button", { name: "Summary" }).click();
  // send_etransfer has 4 fields and only recipient is wrong; the action itself was right.
  await expect(page.getByText("3 of 4 (75%)")).toBeVisible();
  await expect(page.getByText("1 of 1 (100%)").first()).toBeVisible();
});

test("changing the action marks the prediction as wrong action", async ({ page }) => {
  await square(page, 29).click(); // "pay Sam $50 on my credit card", predicted none
  await expect(page.getByTestId("predicted-action")).toHaveText("none");

  await page.getByLabel("Action", { exact: true }).selectOption("send_etransfer");
  await page.getByLabel("recipient", { exact: true }).fill("Sam");
  await page.getByLabel("amount", { exact: true }).fill("50");
  await page.getByLabel("Note (optional)").fill("ambiguous: could be a card payment");
  await page.getByRole("button", { name: "Save and next" }).click();

  await expect(square(page, 29)).toHaveAccessibleName("Message 29, wrong action");
  await page.getByRole("button", { name: "Summary" }).click();
  await expect(page.getByText("none → send_etransfer")).toBeVisible();

  // The mistakes list jumps back to the message, with the saved answer filled in.
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Message 29 of 43" })).toBeVisible();
  await expect(page.getByLabel("Action", { exact: true })).toHaveValue("send_etransfer");
  await expect(page.getByLabel("amount", { exact: true })).toHaveValue("50");
});

test("shows the real form the customer would get for the prediction", async ({ page }) => {
  await page.getByText("Show the form the customer would get").click();

  await expect(page.getByText("Send an e-Transfer")).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("Sam");
});

test("progress survives a reload", async ({ page }) => {
  await page.keyboard.press("y");
  await page.keyboard.press("y");
  await expect(page.getByTestId("progress")).toHaveText("2 of 43 reviewed");

  await page.reload();

  await expect(page.getByTestId("progress")).toHaveText("2 of 43 reviewed");
  await expect(page.getByText("restored your saved progress")).toBeVisible();
});

test("reviewing every message ends on the accuracy summary", async ({ page }) => {
  for (let i = 0; i < 43; i++) await page.keyboard.press("y");

  await expect(page.getByRole("heading", { name: "Accuracy summary" })).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("43 of 43 reviewed");
  await expect(page.getByText("Mistakes (0)")).toBeVisible();
});

test("a downloaded CSV imports back with its annotations", async ({ page, browser }) => {
  await page.keyboard.press("y");
  await page.getByLabel("Action", { exact: true }).selectOption("none");
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByTestId("progress")).toHaveText("2 of 43 reviewed");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download CSV" }).click(),
  ]);
  const path = await download.path();
  const csv = await readFile(path, "utf8");
  expect(csv.split("\n")[0]).toContain("expected_action,expected_params");
  expect(csv).toContain("Send $50 to Sam for dinner last night,send_etransfer,1.000,recipient=Sam (1.00); amount=50.00 (0.98),,send_etransfer,recipient=Sam; amount=50.00");

  // A fresh browser profile, so nothing comes from saved progress.
  const fresh = await browser.newPage();
  await fresh.goto("/annotate");
  await expect(fresh.getByTestId("progress")).toHaveText("0 of 43 reviewed");
  await fresh.getByLabel("Import predictions CSV").setInputFiles({
    name: "my-annotations.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  await expect(fresh.getByText("my-annotations.csv")).toBeVisible();
  await expect(fresh.getByTestId("progress")).toHaveText("2 of 43 reviewed");
  await expect(square(fresh, 1)).toHaveAccessibleName("Message 1, correct");
  await expect(square(fresh, 2)).toHaveAccessibleName("Message 2, wrong action");
  await fresh.close();
});

test("importing a file that isn't a predictions CSV shows an error", async ({ page }) => {
  await page.getByLabel("Import predictions CSV").setInputFiles({
    name: "notes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,email\nSam,sam@example.com\n"),
  });

  await expect(page.getByText(/^Not a predictions CSV/)).toHaveText("Not a predictions CSV: missing column(s) id, message, predicted_action.");
  await expect(page.getByTestId("progress")).toHaveText("0 of 43 reviewed");
});

test("Clear all asks for a second click before wiping every answer", async ({ page }) => {
  await page.keyboard.press("y");
  await expect(page.getByTestId("progress")).toHaveText("1 of 43 reviewed");

  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByTestId("progress")).toHaveText("1 of 43 reviewed");
  await page.getByRole("button", { name: "Click again to clear every answer" }).click();

  await expect(page.getByTestId("progress")).toHaveText("0 of 43 reviewed");
});
