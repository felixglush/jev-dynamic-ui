import { expect, test, type Page } from "@playwright/test";

const FAKE_STT = "http://127.0.0.1:8789";

/** Tells the stand-in speech server what the next recording "says". */
const say = (page: Page, body: { text?: string; fail?: boolean }) => page.request.post(`${FAKE_STT}/__say`, { data: body });

/** Records for a moment with the fake microphone, then stops. */
async function speak(page: Page) {
  await page.getByRole("button", { name: "Record a message" }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await page.getByRole("button", { name: "Stop recording" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("speaking fills the message bar and opens the form for review", async ({ page }) => {
  await say(page, { text: "Send $50 to Sam for dinner last night" });
  await speak(page);

  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Send $50 to Sam for dinner last night");
  await expect(page.getByRole("dialog", { name: "Your request" }).getByText("Send an e-Transfer")).toBeVisible();
  await expect(page.getByLabel("To")).toHaveValue("Sam");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
  // Review first: speaking never confirms anything.
  await expect(page.getByRole("status")).not.toContainText("Demo only");
});

test("a speech-to-text failure explains itself and leaves typing working", async ({ page }) => {
  await say(page, { fail: true });
  await speak(page);

  await expect(page.getByRole("status")).toContainText("speech-to-text service isn't reachable");
  await page.getByLabel("Message", { exact: true }).fill("Send $50 to Sam for dinner");
  await expect(page.getByRole("dialog", { name: "Your request" })).toBeVisible();
});
