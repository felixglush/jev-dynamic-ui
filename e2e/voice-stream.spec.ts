import { expect, test, type Page } from "@playwright/test";

const FAKE_STREAM = "http://127.0.0.1:8790";

/** Tells the stand-in streaming server what the next session "says": all texts but the last as partials, the last as the final text. */
const say = (page: Page, body: { texts?: string[]; fail?: boolean; endpoint?: boolean }) => page.request.post(`${FAKE_STREAM}/__say`, { data: body });
const bar = (page: Page) => page.getByLabel("Message", { exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("text and the form appear while still speaking, and the final text replaces them", async ({ page }) => {
  // A streaming engine writes capitals and spelled-out numbers; the app turns them into what a person would type.
  await say(page, { texts: ["SEND FIFTY", "SEND FIFTY DOLLARS TO SAM", "SEND SEVENTY FIVE DOLLARS TO SAM FOR DINNER LAST NIGHT"] });
  await page.getByRole("button", { name: "Record a message" }).click();

  // Still recording (the Stop button is up), yet the bar and the form already have the partial text.
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await expect(bar(page)).toHaveValue("send 50 dollars to sam");
  // An engine that writes only capitals gives no clue that "sam" is a name, so it stays lowercase.
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("sam");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");

  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(bar(page)).toHaveValue("send 75 dollars to sam for dinner last night");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("75.00");
  // Review first: speaking never confirms anything.
  await expect(page.getByRole("status")).not.toContainText("Demo only");
  await expect(page.getByRole("button", { name: "Record a message" })).toBeEnabled();
});

test("the recording stops by itself when the server hears the customer pause", async ({ page }) => {
  await say(page, { texts: ["SEND FIFTY", "SEND FIFTY DOLLARS TO SAM"], endpoint: true });
  await page.getByRole("button", { name: "Record a message" }).click();

  // Nobody presses Stop: the pause ends the turn, the final text lands and the mic is free again.
  await expect(bar(page)).toHaveValue("send 50 dollars to sam");
  await expect(page.getByRole("button", { name: "Record a message" })).toBeEnabled();
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
  await expect(page.getByRole("status")).not.toContainText("Demo only");
});

test("a streaming server that is down explains itself and leaves typing working", async ({ page }) => {
  await say(page, { fail: true });
  await page.getByRole("button", { name: "Record a message" }).click();

  await expect(page.getByRole("status")).toContainText("speech-to-text service is down");
  await expect(page.getByRole("button", { name: "Record a message" })).toBeEnabled();
  await bar(page).fill("Send $50 to Sam for dinner");
  await expect(page.getByRole("dialog", { name: "Your request" })).toBeVisible();
});
