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

  await expect(page.getByText("Pay your credit card")).toBeVisible();
  await expect(page.getByLabel("How much")).toHaveValue("minimum");
  await expect(page.getByLabel("From account")).toHaveValue("savings");
});

test("open_account: understands a TFSA with a shorthand deposit", async ({ page }) => {
  await say(page, "I want to open a TFSA and put 2k in it");

  await expect(page.getByText("Open a new account")).toBeVisible();
  await expect(page.getByLabel("Account type")).toHaveValue("tfsa");
  await expect(page.getByLabel("Opening deposit (CAD)")).toHaveValue("2000.00");
});

test("add_etransfer_contact: fills name and email", async ({ page }) => {
  await say(page, "add my sister Priya, priya.k@example.com, so I can e-transfer her");

  await expect(page.getByText("Add an e-Transfer contact")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Priya");
  await expect(page.getByLabel("Email")).toHaveValue("priya.k@example.com");
});

test("a message that is not a banking action gets a helpful reply, not a form", async ({ page }) => {
  await say(page, "what's my chequing balance?");

  await expect(page.getByText("I can add an e-Transfer contact")).toBeVisible();
  await expect(page.locator("form[class*='flex-col']")).toHaveCount(0);
});

test("an example chip sends its message", async ({ page }) => {
  await page.getByRole("button", { name: "I want to open a TFSA and put 2k in it" }).click();
  await expect(page.getByLabel("Account type")).toHaveValue("tfsa");
});

test("keeps the conversation: each message gets its own form", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await expect(page.getByText("Send an e-Transfer")).toBeVisible();
  await say(page, "I want to open a TFSA");
  await expect(page.getByText("Open a new account")).toBeVisible();
  await expect(page.getByText("Send an e-Transfer")).toBeVisible();
});

test("submitting a form shows the demo notice instead of moving money", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await page.getByRole("button", { name: "Send money" }).click();
  await expect(page.getByRole("status")).toContainText("nothing was submitted");
});

test("an API failure shows a friendly error and keeps the chat usable", async ({ page }) => {
  await say(page, "simulate-server-error");
  await expect(page.getByText("Something went wrong classifying that message")).toBeVisible();

  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
});
