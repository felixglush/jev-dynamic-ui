import { expect, test, type Page } from "@playwright/test";

const FAKE_STREAM = "http://127.0.0.1:8790";
const FAKE_STT = "http://127.0.0.1:8789";

/** What the next streaming session "says": all texts but the last as partials, the last as the final text. */
const say = (page: Page, body: { texts?: string[]; endpoint?: boolean }) => page.request.post(`${FAKE_STREAM}/__say`, { data: body });
/** What the batch engine answers when the recording is sent to it for a second opinion. */
const batch = (page: Page, body: { texts?: string[]; fail?: boolean }) => page.request.post(`${FAKE_STT}/__say`, { data: body });
const bar = (page: Page) => page.getByLabel("Message", { exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the form fills in while the customer speaks and the bar stays empty until they stop", async ({ page }) => {
  await batch(page, { texts: [] });
  await say(page, { texts: ["SEND FIFTY", "SEND FIFTY DOLLARS TO SAM", "SEND FIFTY DOLLARS TO SAM FOR DINNER"] });
  await page.getByRole("button", { name: "Record a message" }).click();

  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("sam");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
  await expect(bar(page)).toHaveValue("");

  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(bar(page)).toHaveValue("send 50 dollars to sam for dinner");
  await expect(page.getByRole("status")).not.toContainText("Demo only");
});

test("a second engine that hears something different corrects the text and the form", async ({ page }) => {
  await batch(page, { texts: ["Send $75 to Sam for dinner"] });
  await say(page, { texts: ["SEND FIFTY", "SEND FIFTY DOLLARS TO SAM", "SEND FIFTY DOLLARS TO SAM FOR DINNER"] });
  await page.getByRole("button", { name: "Record a message" }).click();
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");

  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(bar(page)).toHaveValue("Send $75 to Sam for dinner");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("75.00");
});

test("a second engine that is down leaves the streamed text in place", async ({ page }) => {
  await batch(page, { fail: true });
  await say(page, { texts: ["SEND FIFTY", "SEND FIFTY DOLLARS TO SAM", "SEND FIFTY DOLLARS TO SAM FOR DINNER"] });
  await page.getByRole("button", { name: "Record a message" }).click();
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
  await page.getByRole("button", { name: "Stop recording" }).click();

  await expect(bar(page)).toHaveValue("send 50 dollars to sam for dinner");
  await expect(page.getByRole("button", { name: "Record a message" })).toBeEnabled();
  await expect(page.getByRole("status")).not.toContainText("speech-to-text");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
});

test("the final text shows the latest answer even when it matches the last partial", async ({ page }) => {
  await batch(page, { texts: [] });
  // The amount is first heard as 50, then as 500. The form holds 50 until a second answer agrees; stopping with the
  // same text must not leave the old value behind.
  await say(page, { texts: ["SEND FIFTY DOLLARS TO SAM", "SEND FIVE HUNDRED DOLLARS TO SAM", "SEND FIVE HUNDRED DOLLARS TO SAM"] });
  await page.getByRole("button", { name: "Record a message" }).click();
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");

  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(bar(page)).toHaveValue("send 500 dollars to sam");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("500.00");
});

test("choosing Live only turns the second pass off without a restart", async ({ page }) => {
  await batch(page, { texts: ["Send $75 to Sam for dinner"] });
  await say(page, { texts: ["SEND FIFTY", "SEND FIFTY DOLLARS TO SAM", "SEND FIFTY DOLLARS TO SAM FOR DINNER"] });
  await page.getByLabel("Speech model").selectOption({ label: "Live only" });
  await page.getByRole("button", { name: "Record a message" }).click();
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
  await page.getByRole("button", { name: "Stop recording" }).click();

  await expect(bar(page)).toHaveValue("send 50 dollars to sam for dinner");
  await page.waitForTimeout(500); // long enough for a second pass to have answered, had there been one
  await expect(bar(page)).toHaveValue("send 50 dollars to sam for dinner");
  expect((await (await page.request.get(`${FAKE_STT}/__seen`)).json()).models).toEqual([]);

  // Picking a model turns it back on, and that model is the one asked.
  await say(page, { texts: ["SEND FIFTY", "SEND FIFTY DOLLARS TO SAM", "SEND FIFTY DOLLARS TO SAM FOR DINNER"] });
  await page.getByLabel("Speech model").selectOption({ label: "Accurate model" });
  await page.getByRole("button", { name: "Record a message" }).click();
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(bar(page)).toHaveValue("Send $75 to Sam for dinner");
  expect((await (await page.request.get(`${FAKE_STT}/__seen`)).json()).models).toEqual(["accurate"]);
});
