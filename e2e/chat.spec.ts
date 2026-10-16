import { expect, test, type Page } from "@playwright/test";

async function say(page: Page, message: string) {
  await page.getByLabel("Message", { exact: true }).fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

/** The floating card that opens after each message. */
const card = (page: Page) => page.getByRole("dialog", { name: "Your request" });
/** The sidebar list of confirmed actions (the desktop column). */
const history = (page: Page) => page.getByRole("complementary", { name: "Actions taken" });

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
  await say(page, "what time does the branch close");

  await expect(page.getByText("I can help with e-Transfers")).toBeVisible();
  await expect(card(page).getByRole("heading", { level: 2 })).toHaveCount(0);
});

test("an example chip sends its message", async ({ page }) => {
  await page.getByRole("button", { name: "I want to open a TFSA and put 2k in it" }).click();
  await expect(page.getByLabel("Account type")).toHaveValue("tfsa");
});

test("the form opens in a floating card right away, before Jev answers", async ({ page }) => {
  // Hold the server's answer so we can see the card while Jev is still thinking.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  await say(page, "Send $50 to Sam");
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByLabel("Edit message")).toHaveValue("Send $50 to Sam");
  await expect(card(page).getByText("Thinking…")).toBeVisible();

  release();
  await expect(card(page).getByText("Send an e-Transfer")).toBeVisible();
  await expect(card(page).getByText("Thinking…")).toHaveCount(0);
});

test("confirming closes the card, shows the demo notice and adds the action to the sidebar", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await page.getByRole("button", { name: "Send Money" }).click();

  await expect(card(page)).toBeHidden();
  await expect(page.getByRole("status")).toContainText("nothing was submitted");
  const entries = history(page).getByRole("listitem");
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText("Send an e-Transfer");
  await expect(entries.first()).toContainText("$50.00 to Sam");
});

test("Return confirms on the spot: focus lands on the confirm button when nothing is missing", async ({ page }) => {
  await page.getByLabel("Message", { exact: true }).fill("pay the minimum on my credit card from savings");
  await page.getByLabel("Message", { exact: true }).press("Enter");

  await expect(card(page).getByRole("button", { name: "Make Payment" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card(page)).toBeHidden();
  await expect(history(page).getByRole("listitem").first()).toContainText("minimum payment from savings");
});

test("focus lands on the missing field, so typing it and pressing Return confirms", async ({ page }) => {
  await page.getByLabel("Message", { exact: true }).fill("send $20 to somebody");
  await page.getByLabel("Message", { exact: true }).press("Enter");

  await expect(page.getByLabel("To")).toBeFocused();
  await page.keyboard.type("Sam");
  await page.keyboard.press("Enter");
  await expect(history(page).getByRole("listitem").first()).toContainText("$20.00 to Sam");
});

test("Esc dismisses the card without recording anything and returns to the message box", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
  await page.keyboard.press("Escape");

  await expect(card(page)).toBeHidden();
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
  await expect(history(page).getByRole("listitem")).toHaveCount(0);
  // The old form's fields are gone from the page once the card has closed.
  await expect(page.getByLabel("To")).toHaveCount(0);
});

test("the dismiss button and a click outside the card both close it", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await card(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(card(page)).toBeHidden();

  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
  await page.mouse.click(5, 5);
  await expect(card(page)).toBeHidden();
});

test("editing the message in the card and pressing Return asks again", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await expect(card(page).getByText("Send an e-Transfer")).toBeVisible();

  await card(page).getByLabel("Edit message").fill("I want to open a TFSA");
  await card(page).getByLabel("Edit message").press("Enter");
  await expect(card(page).getByText("Open a New Account")).toBeVisible();
  await expect(card(page).getByText("Send an e-Transfer")).toHaveCount(0);
});

test("confirmed actions stay in the sidebar after a reload, newest first, until cleared", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await page.getByRole("button", { name: "Send Money" }).click();
  await say(page, "I want to open a TFSA and put 2k in it");
  await page.getByRole("button", { name: "Open Account" }).click();

  await page.reload();
  const entries = history(page).getByRole("listitem");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("tfsa with $2,000.00");
  await expect(entries.nth(1)).toContainText("$50.00 to Sam");

  await history(page).getByRole("button", { name: "Clear" }).click();
  await expect(entries).toHaveCount(0);
  await expect(history(page)).toContainText("Nothing yet");
});

test("on a phone the sidebar becomes a panel behind a button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(history(page)).toBeHidden();
  await say(page, "Send $50 to Sam");
  await page.getByRole("button", { name: "Send Money" }).click();

  await page.getByRole("button", { name: /Actions taken/ }).click();
  const drawer = page.getByRole("dialog", { name: "Actions taken" });
  await expect(drawer.getByRole("listitem")).toContainText("$50.00 to Sam");
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
});

test("an API failure shows a friendly error and keeps the chat usable", async ({ page }) => {
  await say(page, "simulate-server-error");
  await expect(page.getByText("Something went wrong classifying that message")).toBeVisible();
  await page.keyboard.press("Escape");

  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
});

test("sends on Enter, like a normal chat box", async ({ page }) => {
  await page.getByLabel("Message", { exact: true }).fill("I want to open a TFSA");
  await page.getByLabel("Message", { exact: true }).press("Enter");
  await expect(page.getByLabel("Account type")).toHaveValue("tfsa");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
});

test("a request that fails to reach the server shows an error instead of hanging on Thinking", async ({ page }) => {
  // Server Actions are POSTs to the page URL, so block every POST to simulate being offline.
  await page.route("**/*", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await say(page, "Send $50 to Sam");
  await expect(page.getByText("Couldn’t reach the server")).toBeVisible();
  await expect(page.getByText("Thinking…")).toHaveCount(0);
  await page.keyboard.press("Escape");

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

test("headings stay in order: one h1 for the page, an h2 for the sidebar and one for the form", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(history(page).getByRole("heading", { level: 2, name: "Actions taken" })).toBeVisible();
  await say(page, "Send $50 to Sam");
  await expect(card(page).getByRole("heading", { level: 2 })).toHaveCount(1);
});

test("keyboard users get a skip link, and the message bar shows focus", async ({ page }) => {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  // The text box draws no ring itself, so the surrounding bar must change when it is focused.
  const bar = page.locator("form").filter({ has: page.getByLabel("Message", { exact: true }) });
  const before = await bar.evaluate((el) => getComputedStyle(el).boxShadow);
  await page.getByLabel("Message", { exact: true }).focus();
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

test("a label in the card focuses its own input", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await card(page).getByText("Amount (CAD)").click();
  await expect(page.getByLabel("Amount (CAD)")).toBeFocused();
});

test("with reduced motion the card still opens and closes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  await expect(page.getByLabel("To")).toHaveCount(0);
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

test("a corrupted saved history is ignored instead of crashing the sidebar", async ({ page }) => {
  const bad = [
    { id: "x", action: "__proto__", title: "Bad", summary: "", at: 1 },
    { id: "y", action: "send_etransfer", title: "Bad", summary: "", at: 8640000000000001 },
  ];
  await page.evaluate((value) => localStorage.setItem("jev:actions-taken:v1", JSON.stringify(value)), bad);
  await page.reload();
  await expect(history(page)).toContainText("Nothing yet");
});

test("an answer that arrives while the customer is editing the message does not steal focus", async ({ page }) => {
  // Hold the server's answer until the customer has typed into the card's message box.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  await say(page, "send $20 to somebody");
  await card(page).getByLabel("Edit message").focus();
  await page.keyboard.type(" please");
  release();

  await expect(card(page).getByText("Send an e-Transfer")).toBeVisible();
  await expect(card(page).getByLabel("Edit message")).toBeFocused();
  await expect(card(page).getByLabel("Edit message")).toHaveValue("send $20 to somebody please");
});

test("transfer_between_accounts: fills both accounts and a start date", async ({ page }) => {
  await say(page, "move $300 from chequing to savings every month starting 2030-01-15");

  await expect(page.getByText("Transfer Between Your Accounts")).toBeVisible();
  await expect(page.getByLabel("From account")).toHaveValue("chequing");
  await expect(page.getByLabel("To account")).toHaveValue("savings");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("300.00");
  await expect(page.getByLabel("Repeats")).toHaveValue("monthly");
  await expect(page.getByLabel("Date (optional)")).toHaveValue("2030-01-15");
});

test("date fields open a calendar, and picking a day fills the field", async ({ page }) => {
  await say(page, "pay my Hydro One bill $112.30 on 2030-02-01");
  const date = page.getByLabel("Date (optional)");
  await date.focus();
  // The calendar opens on the month of the date Jev found, with that day marked.
  await expect(page.getByRole("group", { name: "February 2030" })).toBeVisible();
  await expect(page.getByRole("button", { name: "February 1, 2030" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "March 15, 2030" }).click();
  await expect(date).toHaveValue("2030-03-15");
  await expect(page.getByRole("group", { name: "March 2030" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open calendar" }).click();
  await page.getByRole("button", { name: "Clear date" }).click();
  await expect(date).toHaveValue("");
});

test("pay_bill: a scheduled bill keeps its date", async ({ page }) => {
  await say(page, "pay my Hydro One bill $112.30 on 2030-02-01");

  await expect(page.getByText("Pay a Bill")).toBeVisible();
  await expect(page.getByLabel("Pay to")).toHaveValue("Hydro One");
  await expect(page.getByLabel("Date (optional)")).toHaveValue("2030-02-01");
});

test("add_payee: the account number needs digits and is required", async ({ page }) => {
  await say(page, "add Rogers as a payee, my account number is 4471-2290-88");
  await expect(page.getByLabel("Company")).toHaveValue("Rogers");
  await expect(page.getByLabel("Your account number with them")).toHaveValue("4471229088");

  // Only one card is open at a time, so close this one before asking again.
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  await say(page, "add Rogers as a payee");
  await expect(page.getByLabel("Your account number with them")).toHaveAttribute("aria-invalid", "true");
});

test("manage_card: the reason only appears when replacing a card", async ({ page }) => {
  await say(page, "lock my debit card");
  await expect(page.getByLabel("What to do")).toHaveValue("lock");
  await expect(page.getByLabel("Why")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lock Card" })).toBeVisible();

  await page.getByLabel("What to do").selectOption("replace");
  await expect(page.getByLabel("Why")).toBeVisible();
  await expect(page.getByRole("button", { name: "Order Replacement" })).toBeVisible();
});

test("manage_card: a stolen card message fills the reason", async ({ page }) => {
  await say(page, "my debit card was stolen, please replace it");
  await expect(page.getByLabel("Why")).toHaveValue("stolen");
  await expect(page.getByLabel("Which card")).toHaveValue("debit");
});

test("view_account: shows sample data, and switching to transactions swaps the view", async ({ page }) => {
  await say(page, "what's my savings balance");

  await expect(page.getByText("Your Account")).toBeVisible();
  await expect(page.getByText("savings balance", { exact: true })).toBeVisible();
  await expect(page.getByText("sample figures")).toBeVisible();

  await page.getByLabel("Show").selectOption("transactions");
  await expect(page.getByRole("list", { name: "Recent savings transactions" })).toBeVisible();
  await expect(page.getByText("savings balance", { exact: true })).toHaveCount(0);
});

test("request_etransfer: fills who and how much", async ({ page }) => {
  await say(page, "request $75 from Sam");
  await expect(page.getByText("Request Money")).toBeVisible();
  await expect(page.getByLabel("Request from")).toHaveValue("Sam");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("75.00");
});

test("cancel_etransfer: fills the recipient", async ({ page }) => {
  await say(page, "cancel the e-transfer I sent to Priya");
  await expect(page.getByText("Cancel an e-Transfer").first()).toBeVisible();
  await expect(page.getByLabel("Sent to")).toHaveValue("Priya");
});

test("setup_autodeposit: fills the account and email", async ({ page }) => {
  await say(page, "turn on autodeposit for me.work@example.com into savings");
  await expect(page.getByText("Turn On Autodeposit").first()).toBeVisible();
  await expect(page.getByLabel("Deposit into")).toHaveValue("savings");
  await expect(page.getByLabel("Your email")).toHaveValue("me.work@example.com");
});

test("dispute_transaction: fills merchant, amount, date and reason", async ({ page }) => {
  await say(page, "I don't recognize a $45.20 charge from Amazon on 2026-10-02");
  await expect(page.getByLabel("Merchant")).toHaveValue("Amazon");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("45.20");
  await expect(page.getByLabel("Date of the charge")).toHaveValue("2026-10-02");
  await expect(page.getByLabel("What went wrong")).toHaveValue("unrecognized");
});

test("update_contact_info: shows only the field being changed", async ({ page }) => {
  await say(page, "change my email to new.me@example.com");
  await expect(page.getByLabel("New email")).toHaveValue("new.me@example.com");
  await expect(page.getByLabel("New mailing address")).toHaveCount(0);

  await page.getByLabel("What to change").selectOption("address");
  await expect(page.getByLabel("New mailing address")).toBeVisible();
  await expect(page.getByLabel("New email")).toHaveCount(0);

  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByLabel("New mailing address")).toBeFocused();
});

test("send_etransfer: a scheduled e-Transfer shows its date and repeat for review", async ({ page }) => {
  await say(page, "send $50 to Sam every week starting 2030-01-15");
  await expect(page.getByLabel("Repeats")).toHaveValue("weekly");
  await expect(page.getByLabel("Date (optional)")).toHaveValue("2030-01-15");
});

test("request_etransfer: an email is enough to name who to ask", async ({ page }) => {
  await say(page, "request $75 from jordan.k@example.com");
  await expect(page.getByLabel("Their email")).toHaveValue("jordan.k@example.com");
  await expect(page.getByLabel("Request from")).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Send Request" }).click();
  await expect(page.getByRole("status")).not.toHaveText("");
});

test("setup_autodeposit: needs an email or a phone number", async ({ page }) => {
  await say(page, "turn on autodeposit into savings");
  await expect(page.getByLabel("Your email")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Your mobile number").fill("4165550199");
  await expect(page.getByLabel("Your email")).not.toHaveAttribute("aria-invalid", "true");
});

test("view_account: a credit card balance is understood", async ({ page }) => {
  await say(page, "what's my credit card balance");
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue("credit_card");
});

test("a confirmed transfer between accounts is summed up in the sidebar with its schedule", async ({ page }) => {
  await say(page, "move $300 from chequing to savings every month starting 2030-01-15");
  await card(page).getByRole("button", { name: "Transfer" }).click();

  await expect(history(page)).toContainText("Transfer Between Your Accounts");
  await expect(history(page)).toContainText("$300.00 from chequing to savings on 2030-01-15 monthly");
});

test("view_account opens in the floating card without a second card around it", async ({ page }) => {
  await say(page, "what's my savings balance");
  await expect(card(page).getByText("savings balance", { exact: true })).toBeVisible();
  await expect(card(page).getByRole("heading", { level: 2, name: "Your Account" })).toBeVisible();
});
