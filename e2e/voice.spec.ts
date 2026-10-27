import { expect, test, type Page } from "@playwright/test";

const FAKE_STT = "http://127.0.0.1:8789";

/** Tells the stand-in speech server what the next recording "says". */
const say = (page: Page, body: { texts?: string[]; fail?: boolean }) => page.request.post(`${FAKE_STT}/__say`, { data: body });

/** Records for a moment with the fake microphone, then stops. */
async function speak(page: Page) {
  await page.getByRole("button", { name: "Record a message" }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await page.waitForTimeout(400); // a recording stopped before the microphone delivers anything is empty
  await page.getByRole("button", { name: "Stop recording" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("speaking fills the message bar and opens the form for review", async ({ page }) => {
  await say(page, { texts: ["Send $50 to Sam for dinner last night"] });
  await speak(page);

  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Send $50 to Sam for dinner last night");
  await expect(page.getByRole("dialog", { name: "Your request" }).getByText("Send an e-Transfer")).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("Sam");
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

test("the text and the form appear while still speaking, then the final text replaces them", async ({ page }) => {
  // Each request gets the next text, like a longer and longer recording.
  await say(page, { texts: ["Send $50", "Send $50 to Sam", "Send $75 to Sam for dinner last night"] });
  await page.getByRole("button", { name: "Record a message" }).click();

  // Still recording (the Stop button is up), yet the bar and the form already have the partial text.
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Send $50 to Sam");
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("Sam");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");

  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Send $75 to Sam for dinner last night");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("75.00");
});

test("the speech model dropdown lists what the server can run and the pick goes with the recording", async ({ page }) => {
  await say(page, { texts: ["Send $50 to Sam for dinner last night"] });
  const picker = page.getByLabel("Speech model");
  await expect(picker.getByRole("option")).toHaveText(["Fast model", "Accurate model"]); // the unavailable one is left out
  await expect(picker).toHaveValue("fast");

  await picker.selectOption({ label: "Accurate model" });
  await speak(page);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Send $50 to Sam for dinner last night");
  expect((await (await page.request.get(`${FAKE_STT}/__seen`)).json()).models.at(-1)).toBe("accurate");

  // The pick is remembered.
  await page.reload();
  await expect(page.getByLabel("Speech model")).toHaveValue("accurate");
});
