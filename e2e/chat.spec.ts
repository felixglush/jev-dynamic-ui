import { expect, test, type Page } from "@playwright/test";

async function say(page: Page, message: string) {
  await composer(page).fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

/** The floating card that opens after each message. */
const card = (page: Page) => page.getByRole("dialog", { name: "Your request" });
const composer = (page: Page) => page.getByLabel("Message", { exact: true });

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
  await expect(composer(page)).toHaveValue("Send $50 to Sam");
  await expect(card(page).getByText("Thinking…")).toBeVisible();

  release();
  await expect(card(page).getByText("Send an e-Transfer")).toBeVisible();
  await expect(card(page).getByText("Thinking…")).toHaveCount(0);
});

test("confirming closes the card and sums up what was confirmed", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await page.getByRole("button", { name: "Send Money" }).click();

  await expect(card(page)).toBeHidden();
  await expect(page.getByRole("status")).toContainText("nothing was submitted");
  await expect(page.getByRole("status")).toContainText("Send an e-Transfer: $50.00 to Sam");
  await expect(composer(page)).toHaveValue("");
});

test("Return confirms on the spot: focus lands on the confirm button when nothing is missing", async ({ page }) => {
  await composer(page).fill("pay the minimum on my credit card from savings");
  await composer(page).press("Enter");

  await expect(card(page).getByRole("button", { name: "Make Payment" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card(page)).toBeHidden();
  await expect(page.getByRole("status")).toContainText("minimum payment from savings");
});

test("focus lands on the missing field, so typing it and pressing Return confirms", async ({ page }) => {
  await composer(page).fill("send $20 to somebody");
  await composer(page).press("Enter");

  await expect(page.getByLabel("To")).toBeFocused();
  await page.keyboard.type("Sam");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("$20.00 to Sam");
});

test("Esc dismisses the card, empties the message box and keeps focus there", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
  await page.keyboard.press("Escape");

  await expect(card(page)).toBeHidden();
  await expect(composer(page)).toBeFocused();
  await expect(composer(page)).toHaveValue("");
  await expect(page.getByRole("status")).toHaveText("");
  // The old form's fields are gone from the page once the card has closed.
  await expect(page.getByLabel("To")).toHaveCount(0);
});

test("an API failure shows a friendly error and keeps the chat usable", async ({ page }) => {
  await say(page, "simulate-server-error");
  await expect(page.getByText("Something went wrong classifying that message")).toBeVisible();
  await page.keyboard.press("Escape");

  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
});

test("sends on Enter, like a normal chat box", async ({ page }) => {
  await composer(page).fill("I want to open a TFSA");
  await composer(page).press("Enter");
  await expect(page.getByLabel("Account type")).toHaveValue("tfsa");
  // The message stays in the bar so it can be refined while the card is open.
  await expect(composer(page)).toHaveValue("I want to open a TFSA");
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

test("headings stay in order: one h1 for the page and one h2 for the form", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
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
  const bar = page.locator("form").filter({ has: composer(page) });
  const before = await bar.evaluate((el) => getComputedStyle(el).boxShadow);
  await composer(page).focus();
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

test("a confirmed transfer between accounts is summed up with its schedule", async ({ page }) => {
  await say(page, "move $300 from chequing to savings every month starting 2030-01-15");
  await card(page).getByRole("button", { name: "Transfer" }).click();

  await expect(page.getByRole("status")).toContainText("Transfer Between Your Accounts");
  await expect(page.getByRole("status")).toContainText("$300.00 from chequing to savings on 2030-01-15 monthly");
});

test("view_account opens in the floating card without a second card around it", async ({ page }) => {
  await say(page, "what's my savings balance");
  await expect(card(page).getByText("savings balance", { exact: true })).toBeVisible();
  await expect(card(page).getByRole("heading", { level: 2, name: "Your Account" })).toBeVisible();
});

test("a click outside the card dismisses it", async ({ page }) => {
  await say(page, "Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
  await page.mouse.click(5, 5);
  await expect(card(page)).toBeHidden();
  await expect(composer(page)).toHaveValue("");
});

test("the card opens by itself while typing, and refills as more is said", async ({ page }) => {
  await composer(page).pressSequentially("Send some money");
  // No Return pressed: the first detected intent opens the form, with nothing to fill in yet.
  await expect(card(page).getByText("Send an e-Transfer")).toBeVisible();
  await expect(page.getByLabel("To")).toHaveValue("");

  await composer(page).pressSequentially(" to Sam, $50");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
  // The customer never left the message bar.
  await expect(composer(page)).toBeFocused();
});

test("typing in quick bursts asks Jev once, after the pause", async ({ page }) => {
  let asked = 0;
  page.on("request", (request) => request.method() === "POST" && asked++);
  // No spaces, so nothing ends a word: only the pause triggers a question.
  await composer(page).pressSequentially("Send$50toSamfordinnerlastnight");
  await expect.poll(() => asked).toBe(1);
  await page.waitForTimeout(800);
  expect(asked).toBe(1);
});

test("a space asks Jev right away, without waiting for the pause", async ({ page }) => {
  let asked = 0;
  page.on("request", (request) => request.method() === "POST" && asked++);
  await composer(page).pressSequentially("Send $50 to Sam");
  // Three spaces were typed, each ending a word, so Jev is asked once per space; the pause alone would ask once.
  await expect.poll(() => asked).toBeGreaterThanOrEqual(3);
  await expect(page.getByLabel("To")).toHaveValue("Sam");
});

test("deleting back to a space does not skip the pause", async ({ page }) => {
  await composer(page).pressSequentially("Send $50 to Sam");
  await expect(page.getByLabel("To")).toHaveValue("Sam");
  let asked = 0;
  page.on("request", (request) => request.method() === "POST" && asked++);
  // Backspace over "Sam": the last deletion leaves the text ending in a space, but no space was typed.
  await composer(page).press("Backspace");
  await composer(page).press("Backspace");
  await composer(page).press("Backspace");
  expect(asked).toBe(0);
  await expect.poll(() => asked).toBe(1);
});

test("a field the customer already edited keeps their value when more is typed", async ({ page }) => {
  await composer(page).pressSequentially("Send some money");
  await expect(page.getByLabel("To")).toHaveValue("");
  await page.getByLabel("To").fill("Alex");

  await composer(page).focus();
  await composer(page).pressSequentially(" to Sam, $50");
  await expect(page.getByLabel("Amount (CAD)")).toHaveValue("50.00");
  await expect(page.getByLabel("To")).toHaveValue("Alex");
});

test("saying something else swaps the form, and clearing the message closes the card", async ({ page }) => {
  await composer(page).fill("Send $50 to Sam");
  await expect(card(page).getByText("Send an e-Transfer")).toBeVisible();

  await composer(page).fill("I want to open a TFSA");
  await expect(card(page).getByText("Open a New Account")).toBeVisible();
  await expect(card(page).getByText("Send an e-Transfer")).toHaveCount(0);

  await composer(page).fill("");
  await expect(card(page)).toBeHidden();
});

test("an answer to something typed earlier never overwrites the form for what is typed now", async ({ page }) => {
  // Hold the first two answers separately, so the older one can land while the newer one is pending.
  const releases: (() => void)[] = [];
  const holds = [0, 1].map(() => new Promise<void>((resolve) => releases.push(resolve)));
  let posts = 0;
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST") await holds[posts++];
    await route.continue();
  });
  const firstAsked = page.waitForRequest((request) => request.method() === "POST");
  await composer(page).fill("Send $50 to Sam");
  await firstAsked;
  await composer(page).fill("I want to open a TFSA");

  // Next runs a page's server actions one after another, so the older answer lands first. It must
  // be dropped, because by then the customer has typed something else.
  releases[0]!();
  await page.waitForTimeout(400);
  await expect(card(page)).toBeHidden();
  await expect(page.getByLabel("To")).toHaveCount(0);

  releases[1]!();
  await expect(card(page).getByText("Open a New Account")).toBeVisible();
  await expect(card(page).getByText("Send an e-Transfer")).toHaveCount(0);
});

test("while typing, a message that is not an action stays quiet; Return explains", async ({ page }) => {
  await composer(page).fill("what time does the branch close");
  await page.waitForTimeout(1200);
  await expect(card(page)).toBeHidden();

  await composer(page).press("Enter");
  await expect(card(page).getByText("I can help with e-Transfers")).toBeVisible();
});

test("replacing the message with a non-action takes the old form away", async ({ page }) => {
  await composer(page).fill("Send $50 to Sam");
  await expect(card(page).getByText("Send an e-Transfer")).toBeVisible();

  await composer(page).fill("what time does the branch close");
  await expect(card(page)).toBeHidden();
  // Nothing is left on the page to confirm by mistake.
  await expect(page.getByLabel("To")).toHaveCount(0);
});

test("clearing the message while an answer is on its way keeps that answer from opening a card", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  const asked = page.waitForRequest((request) => request.method() === "POST");
  await composer(page).fill("Send $50 to Sam");
  await asked;
  await composer(page).fill("");

  release();
  await page.waitForTimeout(500);
  await expect(card(page)).toBeHidden();
});

test("pressing Return before the newest answer arrives does not focus the older form", async ({ page }) => {
  await composer(page).fill("Send $50 to Sam");
  await expect(card(page).getByText("Send an e-Transfer")).toBeVisible();

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  const asked = page.waitForRequest((request) => request.method() === "POST");
  await composer(page).fill("I want to open a TFSA");
  await asked;
  await composer(page).press("Enter");
  await expect(card(page).getByRole("button", { name: "Send Money" })).not.toBeFocused();

  release();
  await expect(card(page).getByRole("button", { name: "Open Account" })).toBeFocused();
});

test("every message sent (not typed) is logged for review on the annotate page", async ({ page }) => {
  const { readFile } = await import("node:fs/promises");
  const { PREDICTIONS_LOG } = await import("./paths");
  await say(page, "Send $77 to Logan for the logging test");
  await expect(page.getByText("Send an e-Transfer")).toBeVisible();
  await expect
    .poll(async () => (await readFile(PREDICTIONS_LOG, "utf8").catch(() => "")))
    .toMatch(/^live-[^\n]*Send \$77 to Logan for the logging test,send_etransfer,/m);
});

test("what is typed while the card updates is not logged until Return sends it", async ({ page }) => {
  const { readFile } = await import("node:fs/promises");
  const { PREDICTIONS_LOG } = await import("./paths");
  const logged = async () => (await readFile(PREDICTIONS_LOG, "utf8").catch(() => "")).split("\n").filter((line) => line.includes("Send $88 to Quinn for the typing test"));
  await composer(page).pressSequentially("Send $88 to Quinn for the typing test");
  await expect(card(page).getByText("Send an e-Transfer")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await logged()).toHaveLength(0);

  await composer(page).press("Enter");
  await expect.poll(async () => (await logged()).length).toBe(1);
});
