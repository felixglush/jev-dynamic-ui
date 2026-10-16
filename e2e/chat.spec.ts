import { expect, test, type Page } from "@playwright/test";

async function say(page: Page, message: string) {
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("renders the chat shell from the server, before any message", async ({ request }) => {
  // Plain HTTP fetch, no JavaScript: this is the server-rendered HTML.
  const html = await (await request.get("/")).text();
  expect(html).toContain("Banking assistant");
  expect(html).toContain("Try one of these");
});

test("send_etransfer: opens the e-Transfer form pre-filled from the message", async ({ page }) => {
  await say(page, "Send $50 to Sam for dinner last night");

  await expect(page.getByText("Send an e-Transfer")).toBeVisible();
  await expect(page.getByLabel("To")).toHaveValue("Sam");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
  // The fake reports low confidence for amounts, so the form asks the customer to double-check it.
  await expect(page.getByText("Please check")).toBeVisible();
  // Nothing was said about the account, so no guess was made.
  await expect(page.getByLabel("From account")).toHaveValue("");
});

test("flags a required field the customer did not give", async ({ page }) => {
  await say(page, "send $20 to somebody");

  await expect(page.getByText("Send an e-Transfer")).toBeVisible();
  await expect(page.getByLabel("To")).toHaveValue("");
  await expect(page.getByLabel("To")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Needed")).toBeVisible();
});

test("pay_credit_card: fills dropdowns from the catalog options", async ({ page }) => {
  await say(page, "pay the minimum on my credit card from savings");

  await expect(page.getByText("Pay Your Credit Card")).toBeVisible();
  await expect(page.getByLabel("How much")).toHaveValue("minimum");
  await expect(page.getByLabel("From account")).toHaveValue("savings");
});

test("open_account: understands a TFSA with a shorthand deposit", async ({ page }) => {
  await say(page, "I want to open a TFSA and put 2k in it");

  await expect(page.getByText("Open a New Account")).toBeVisible();
  await expect(page.getByLabel("Account type")).toHaveValue("tfsa");
  await expect(page.getByLabel("Opening deposit (CAD)")).toHaveValue("2000.00");
});

test("add_etransfer_contact: fills name and email", async ({ page }) => {
  await say(page, "add my sister Priya, priya.k@example.com, so I can e-transfer her");

  await expect(page.getByText("Add an e-Transfer Contact")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Priya");
  await expect(page.getByLabel("Email")).toHaveValue("priya.k@example.com");
});

test("a message that is not a banking action gets a helpful reply, not a form", async ({ page }) => {
  await say(page, "what's my chequing balance?");

  await expect(page.getByText("I can add an e-Transfer contact")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
});

test("an example chip sends its message", async ({ page }) => {
  await page.getByRole("button", { name: "I want to open a TFSA and put 2k in it" }).click();
  await expect(page.getByLabel("Account type")).toHaveValue("tfsa");
});

test("keeps the conversation: each message gets its own form", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await expect(page.getByText("Send an e-Transfer")).toBeVisible();
  await say(page, "I want to open a TFSA");
  await expect(page.getByText("Open a New Account")).toBeVisible();
  await expect(page.getByText("Send an e-Transfer")).toBeVisible();
});

test("submitting a form shows the demo notice instead of moving money", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await page.getByRole("button", { name: "Send Money" }).click();
  await expect(page.getByRole("status")).toContainText("nothing was submitted");
});

test("an API failure shows a friendly error and keeps the chat usable", async ({ page }) => {
  await say(page, "simulate-server-error");
  await expect(page.getByText("Something went wrong classifying that message")).toBeVisible();

  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
});

test("sends on Enter, like a normal chat box", async ({ page }) => {
  await page.getByLabel("Message").fill("I want to open a TFSA");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByLabel("Account type")).toHaveValue("tfsa");
  await expect(page.getByLabel("Message")).toHaveValue("");
});

test("a request that fails to reach the server shows an error instead of hanging on Thinking", async ({ page }) => {
  // Server Actions are POSTs to the page URL, so block every POST to simulate being offline.
  await page.route("**/*", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await say(page, "Send $50 to Sam");
  await expect(page.getByText("Couldn’t reach the server")).toBeVisible();
  await expect(page.getByText("Thinking…")).toHaveCount(0);

  await page.unroute("**/*");
  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
});

test("an empty required field blocks submit and takes focus, instead of showing the demo notice", async ({ page }) => {
  await say(page, "send $20 to somebody");
  await page.getByRole("button", { name: "Send Money" }).click();

  await expect(page.getByLabel("To")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("");
});

test("a screen reader hears why a field needs attention", async ({ page }) => {
  await say(page, "send $20 to somebody");
  await expect(page.getByLabel("To")).toHaveAccessibleDescription("Needed");
  await expect(page.getByLabel("Amount (CAD)")).toHaveAccessibleDescription("Please check");
});

test("headings stay in order: one h1 for the page, one h2 per form", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await say(page, "Send $50 to Sam");
  await say(page, "I want to open a TFSA");
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(2);
});

test("keyboard users get a skip link, and the message bar shows focus", async ({ page }) => {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  // The text box draws no ring itself, so the surrounding bar must change when it is focused.
  const bar = page.locator("form").filter({ has: page.getByLabel("Message") });
  const before = await bar.evaluate((el) => getComputedStyle(el).boxShadow);
  await page.getByLabel("Message").focus();
  const after = await bar.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(after).not.toBe(before);
});

test("unknown pages get a friendly 404 with a way back", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page Not Found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to the Assistant" }).click();
  await expect(page).toHaveURL("/");
});

test("sets browser theme colors for light and dark", async ({ page }) => {
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
});

test("two forms on screen keep separate fields: a label focuses its own input", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("Amount (CAD)")).toHaveCount(1);
  await say(page, "Send $20 to Priya");
  await expect(page.getByLabel("Amount (CAD)")).toHaveCount(2);

  await page.getByText("Amount (CAD)").nth(1).click();
  await expect(page.getByLabel("Amount (CAD)").nth(1)).toBeFocused();
});

test("typing into a Needed field clears the badge", async ({ page }) => {
  await say(page, "send $20 to somebody");
  await expect(page.getByText("Needed")).toBeVisible();
  await page.getByLabel("To").fill("Sam");
  await expect(page.getByText("Needed")).toHaveCount(0);
  await expect(page.getByLabel("To")).not.toHaveAttribute("aria-invalid", "true");
});

test("choosing a custom payment amount makes the amount required", async ({ page }) => {
  await say(page, "pay my credit card");
  await page.getByLabel("How much").selectOption("custom");
  await page.getByRole("button", { name: "Make Payment" }).click();

  await expect(page.getByLabel("Custom amount (CAD)")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("");

  await page.getByLabel("Custom amount (CAD)").fill("75");
  await page.getByRole("button", { name: "Make Payment" }).click();
  await expect(page.getByRole("status")).not.toHaveText("");
});
