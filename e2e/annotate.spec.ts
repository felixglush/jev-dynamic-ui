import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { ANNOTATIONS_FILE } from "./paths";

// These run against the real predictions.csv at the project root (100 messages from a live
// Jev run), served by the production build. No Jev calls are made on this page.

/** Open the page and wait until it is interactive: the HTML shows up before keys do anything. */
async function open(page: Page) {
  await page.goto("/annotate");
  await expect(page.locator("[data-interactive]")).toBeVisible();
}

/** Press Y once LiquidFM has answered: Correct stays disabled while the message is being read. */
async function accept(page: Page) {
  await expect(page.locator("[data-accept]")).toBeEnabled();
  await page.keyboard.press("y");
}

const square = (page: Page, n: number) => page.getByRole("navigation", { name: "Messages" }).getByRole("button").nth(n - 1);

/** What the app has saved to disk so far, or null if nothing. */
async function savedFile() {
  return readFile(ANNOTATIONS_FILE, "utf8").catch(() => null);
}

test.beforeEach(async ({ page }) => {
  await rm(ANNOTATIONS_FILE, { force: true });
  await open(page);
  await expect(page.getByRole("heading", { name: "Message 1 of 100" })).toBeVisible();
  await expect(page.getByTestId("extractor-status")).toContainText("LiquidFM read");
});

test.afterEach(async ({ page }) => {
  // An autosave still in flight when the page closes could write the file during the next test.
  await expect(page.getByTestId("file-status")).not.toContainText("Saving");
});

test("renders the first prediction on the server", async ({ request }) => {
  // React separates adjacent text with <!-- --> markers in its HTML; drop them before matching.
  const html = (await (await request.get("/annotate")).text()).replaceAll("<!-- -->", "");
  expect(html).toContain("Send $50 to Sam for dinner last night");
  expect(html).toContain("0 of 100 reviewed");
});

test("Y marks a prediction correct and moves to the next message", async ({ page }) => {
  await accept(page);

  await expect(page.getByRole("heading", { name: "Message 2 of 100" })).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("1 of 100 reviewed");
  await expect(square(page, 1)).toHaveAccessibleName("Message 1, correct");
});

test("fixing a value marks the prediction as wrong values", async ({ page }) => {
  await square(page, 3).click(); // "can you etransfer my landlord $1,850 for rent from chequing"
  // Jev picked "my landlord"; LiquidFM read "landlord", and LiquidFM's value is the one pre-filled.
  await expect(page.getByLabel("recipient", { exact: true })).toHaveValue("landlord");
  // Every field says who filled it: the action is Jev's, the typed-in recipient is LiquidFM's.
  await expect(page.getByTestId("action-source")).toHaveText("Jev");
  await expect(page.locator('tr[data-field="recipient"]')).toHaveAttribute("data-source", "liquid");
  await expect(page.locator('tr[data-field="recipient"]').getByText("LiquidFM")).toBeVisible();

  await page.keyboard.press("n");
  await expect(page.getByLabel("Action", { exact: true })).toBeFocused();
  await page.getByLabel("recipient", { exact: true }).fill("Landlord Inc");
  await page.getByLabel("recipient", { exact: true }).press("Enter");

  await expect(page.getByRole("heading", { name: "Message 4 of 100" })).toBeVisible();
  await expect(square(page, 3)).toHaveAccessibleName("Message 3, wrong values");

  await page.getByRole("button", { name: "Summary" }).click();
  // send_etransfer has 6 fields and only recipient is wrong; the action itself was right.
  await expect(page.getByText("5 of 6 (83%)")).toBeVisible();
  await expect(page.getByText("1 of 1 (100%)").first()).toBeVisible();
});

test("changing the action marks the prediction as wrong action", async ({ page }) => {
  await square(page, 74).click(); // "pay Sam $50 on my credit card", predicted none
  await expect(page.getByTestId("predicted-action")).toHaveText("none");

  await page.getByLabel("Action", { exact: true }).selectOption("send_etransfer");
  await page.getByLabel("recipient", { exact: true }).fill("Sam");
  await page.getByLabel("amount", { exact: true }).fill("50");
  await page.getByLabel("Note (optional)").fill("ambiguous: could be a card payment");
  await page.getByRole("button", { name: "Save and next" }).click();

  await expect(square(page, 74)).toHaveAccessibleName("Message 74, wrong action");
  await page.getByRole("button", { name: "Summary" }).click();
  await expect(page.getByText("none → send_etransfer")).toBeVisible();

  // The mistakes list jumps back to the message, with the saved answer filled in.
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Message 74 of 100" })).toBeVisible();
  await expect(page.getByLabel("Action", { exact: true })).toHaveValue("send_etransfer");
  await expect(page.getByLabel("amount", { exact: true })).toHaveValue("50");
});

const row = (page: Page, field: string) => page.locator(`tr[data-field="${field}"]`);

test("marks which model filled each field: LiquidFM for typed-in values, Jev for choices", async ({ page }) => {
  await square(page, 3).click(); // "can you etransfer my landlord $1,850 for rent from chequing"
  await expect(page.getByTestId("extractor-status")).toContainText("LiquidFM read");

  // Names and amounts are read by LiquidFM; where Jev disagreed, its value is shown too.
  await expect(row(page, "recipient")).toHaveAttribute("data-source", "liquid");
  await expect(row(page, "recipient")).toContainText("landlord");
  await expect(row(page, "recipient")).toContainText("Jev said my landlord");
  await expect(row(page, "recipient").getByText("LiquidFM", { exact: true })).toBeVisible();
  await expect(row(page, "amount")).toContainText("1850.00");
  await expect(row(page, "amount")).toHaveAttribute("data-source", "liquid");

  // Which account to use is a choice, and choices are Jev's.
  await expect(row(page, "from_account")).toHaveAttribute("data-source", "jev");
  await expect(row(page, "from_account").getByText("Jev", { exact: true })).toBeVisible();

  // Nobody found a date or an email: the row says so instead of staying quiet.
  await expect(row(page, "date")).toHaveAttribute("data-source", "blank");
  await expect(row(page, "date")).toContainText("not stated");
});

test("Correct accepts the combined values, not only Jev's", async ({ page }) => {
  await square(page, 3).click();
  await expect(page.getByTestId("extractor-status")).toContainText("LiquidFM read");
  await expect(page.getByLabel("amount", { exact: true })).toHaveValue("1850.00");
  await accept(page);

  await expect(page.getByRole("heading", { name: "Message 4 of 100" })).toBeVisible();
  await expect.poll(savedFile).toContain(",send_etransfer,recipient=landlord; amount=1850.00; from_account=chequing");
});

test("a message Jev gave no action has nothing for LiquidFM to read", async ({ page }) => {
  await square(page, 74).click(); // predicted none
  await expect(page.getByTestId("predicted-action")).toHaveText("none");
  await expect(page.getByTestId("extractor-status")).toHaveCount(0);
  await expect(page.locator("[data-accept]")).toBeEnabled();
});

test("when the extractor is down, Jev's values are shown and say so", async ({ page, request }) => {
  await request.post("http://127.0.0.1:8788/__mode", { data: { fail: true } });
  try {
    await square(page, 2).click(); // not read yet, so LiquidFM is asked now
    await expect(page.getByTestId("extractor-status")).toContainText("LiquidFM didn't answer");
    await expect(row(page, "recipient")).toHaveAttribute("data-source", "jev");
    await expect(page.getByLabel("recipient", { exact: true })).toHaveValue("jordan");
    await expect(page.locator("[data-accept]")).toBeEnabled();
  } finally {
    await request.post("http://127.0.0.1:8788/__mode", { data: { fail: false } });
  }
});

test("shows the real form the customer would get for the prediction", async ({ page }) => {
  await page.getByText("Show the form the customer would get").click();

  await expect(page.getByText("Send an e-Transfer")).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("Sam");
});

test("progress survives a reload", async ({ page }) => {
  await accept(page);
  await accept(page);
  await expect(page.getByTestId("progress")).toHaveText("2 of 100 reviewed");

  await page.reload();
  await expect(page.locator("[data-interactive]")).toBeVisible();

  await expect(page.getByTestId("progress")).toHaveText("2 of 100 reviewed");
  await expect(page.getByText("restored your saved progress")).toBeVisible();
});

test("reviewing every message ends on the accuracy summary", async ({ page }) => {
  for (let i = 0; i < 100; i++) await accept(page);

  await expect(page.getByRole("heading", { name: "Accuracy summary" })).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("100 of 100 reviewed");
  // Not "Mistakes (0)": the summary still scores Jev's own values, so wherever LiquidFM read a
  // value differently and the annotator pressed Correct, that counts against Jev.
  await expect(page.getByText(/^Mistakes \(\d+\)/)).toBeVisible();
});

test("a downloaded CSV imports back with its annotations", async ({ page, browser }) => {
  await accept(page);
  await page.getByLabel("Action", { exact: true }).selectOption("none");
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByTestId("progress")).toHaveText("2 of 100 reviewed");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download CSV" }).click(),
  ]);
  const path = await download.path();
  const csv = await readFile(path, "utf8");
  expect(csv.split("\n")[0]).toContain("expected_action,expected_params");
  expect(csv).toContain("Send $50 to Sam for dinner last night,send_etransfer,1.000,recipient=Sam (1.00); amount=50.00 (0.98),,send_etransfer,recipient=Sam; amount=50.00");

  // A fresh browser profile and no saved file, so nothing comes from saved progress.
  await expect(page.getByTestId("file-status")).toHaveText(/^Saved to/);
  await rm(ANNOTATIONS_FILE, { force: true });
  const fresh = await browser.newPage();
  await open(fresh);
  await expect(fresh.getByTestId("progress")).toHaveText("0 of 100 reviewed");
  await fresh.getByLabel("Import predictions CSV").setInputFiles({
    name: "my-annotations.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  await expect(fresh.getByText("my-annotations.csv")).toBeVisible();
  await expect(fresh.getByTestId("progress")).toHaveText("2 of 100 reviewed");
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
  await expect(page.getByTestId("progress")).toHaveText("0 of 100 reviewed");
});

test("Clear all asks for a second click before wiping every answer", async ({ page }) => {
  await accept(page);
  await expect(page.getByTestId("progress")).toHaveText("1 of 100 reviewed");

  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByTestId("progress")).toHaveText("1 of 100 reviewed");
  await page.getByRole("button", { name: "Click again to clear every answer" }).click();

  await expect(page.getByTestId("progress")).toHaveText("0 of 100 reviewed");
});

test("re-importing a file keeps the progress saved in this browser", async ({ page }) => {
  const csv = await readFile("predictions.csv", "utf8");
  const file = { name: "predictions-copy.csv", mimeType: "text/csv", buffer: Buffer.from(csv) };
  await page.getByLabel("Import predictions CSV").setInputFiles(file);
  await accept(page);
  await expect(page.getByTestId("progress")).toHaveText("1 of 100 reviewed");

  await page.reload();
  await expect(page.locator("[data-interactive]")).toBeVisible();
  await page.getByLabel("Import predictions CSV").setInputFiles(file);

  await expect(page.getByTestId("progress")).toHaveText("1 of 100 reviewed");
  await expect(page.getByText("restored your saved progress")).toBeVisible();
});

test.describe("autosave to a file", () => {
  test("every saved answer is written to the file", async ({ page }) => {
    await accept(page);
    await expect(page.getByTestId("file-status")).toHaveText(`Saved to ${ANNOTATIONS_FILE}`);

    const csv = (await savedFile())!;
    expect(csv.split("\n")[0]).toContain("expected_action,expected_params");
    expect(csv).toContain("Send $50 to Sam for dinner last night,send_etransfer,1.000,recipient=Sam (1.00); amount=50.00 (0.98),,send_etransfer,recipient=Sam; amount=50.00");

    await page.getByLabel("Action", { exact: true }).selectOption("none");
    await page.getByRole("button", { name: "Save and next" }).click();
    await expect.poll(async () => ((await savedFile()) ?? "").match(/,none,,/g)?.length ?? 0).toBeGreaterThan(0);
  });

  test("a different browser picks the saved answers up from the file", async ({ page, browser }) => {
    await accept(page);
    await accept(page);
    await expect(page.getByTestId("file-status")).toHaveText(/^Saved to/);

    // A new browser profile has empty localStorage, so only the file can restore these.
    const other = await browser.newPage();
    await open(other);
    await expect(other.getByTestId("progress")).toHaveText("2 of 100 reviewed");
    await expect(other.getByText("restored your saved progress")).toBeVisible();
    await expect(square(other, 2)).toHaveAccessibleName("Message 2, correct");
    await other.close();
  });

  test("answers saved for different messages are not applied", async ({ browser }) => {
    // Pretend predictions.csv was regenerated: message 1 now says something else.
    const edited = [
      "id,group,message,predicted_action,action_confidence,params,missing_required,expected_action,expected_params,note,annotator_note",
      "1,send_etransfer,Send $75 to Sam,send_etransfer,1.000,recipient=Sam (1.00); amount=75.00 (0.98),,send_etransfer,recipient=Sam; amount=75,,",
      "2,send_etransfer,e-transfer 120 to jordan for the concert tickets,send_etransfer,1.000,recipient=jordan (0.99); amount=120.00 (1.00),,send_etransfer,recipient=jordan; amount=120.00,,",
      "",
    ].join("\n");
    await mkdir(path.dirname(ANNOTATIONS_FILE), { recursive: true });
    await writeFile(ANNOTATIONS_FILE, edited);

    const other = await browser.newPage();
    await open(other);

    await expect(other.getByTestId("progress")).toHaveText("1 of 100 reviewed");
    await expect(square(other, 1)).toHaveAccessibleName("Message 1, not reviewed");
    await expect(square(other, 2)).toHaveAccessibleName("Message 2, correct");
    await other.close();
  });

  test("an unreadable file is left alone and the browser keeps working", async ({ browser }) => {
    await mkdir(path.dirname(ANNOTATIONS_FILE), { recursive: true });
    await writeFile(ANNOTATIONS_FILE, "id,message,predicted_action,expected_action\n1,hi,none,wire_money\n");

    const other = await browser.newPage();
    await open(other);
    await expect(other.getByTestId("file-status")).toContainText("Couldn't read the saved file");
    await accept(other);

    await expect(other.getByTestId("progress")).toHaveText("1 of 100 reviewed");
    expect(await savedFile()).toContain("wire_money");
    await other.close();
  });

  test("an imported CSV stays in the browser and leaves the file alone", async ({ page }) => {
    await accept(page);
    await expect(page.getByTestId("file-status")).toHaveText(/^Saved to/);
    const before = await savedFile();

    const csv = await readFile("predictions.csv", "utf8");
    await page.getByLabel("Import predictions CSV").setInputFiles({ name: "other.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByTestId("file-status")).toHaveText("Imported file: saved in this browser only");
    await accept(page);
    await accept(page);
    await expect(page.getByTestId("progress")).toHaveText("2 of 100 reviewed");

    expect(await savedFile()).toBe(before);
  });

  test("two browsers answering different messages both end up in the file", async ({ page, browser }) => {
    // Both pages loaded the same empty state. The other one answers message 2 first.
    const other = await browser.newPage();
    await open(other);
    await square(other, 2).click();
    await accept(other);
    await expect(other.getByTestId("file-status")).toHaveText(/^Saved to/);
    await other.close();

    // This page still thinks nothing is answered, then answers message 1.
    await accept(page);
    await expect(page.getByTestId("file-status")).toHaveText(/^Saved to/);

    const csv = (await savedFile())!;
    expect(csv).toContain("Send $50 to Sam for dinner last night,send_etransfer,1.000,recipient=Sam (1.00); amount=50.00 (0.98),,send_etransfer");
    expect(csv).toContain("jordan (0.99); amount=120.00 (1.00),,send_etransfer");
  });

  test("Clear all empties the file too", async ({ page }) => {
    await accept(page);
    await expect(page.getByTestId("file-status")).toHaveText(/^Saved to/);
    expect(await savedFile()).toContain(",send_etransfer,recipient=Sam");

    await page.getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("button", { name: "Click again to clear every answer" }).click();

    await expect.poll(async () => ((await savedFile()) ?? "").includes("recipient=Sam; amount")).toBe(false);
  });
});

test.describe("fine-tuning files", () => {
  const sft = { name: "examples.jsonl", mimeType: "application/jsonl" };

  test("an SFT file imports, and Fields only shows just the model's fields with blanks marked", async ({ page }) => {
    const buffer = await readFile("e2e/fixtures/examples.jsonl");
    await page.getByLabel("Import predictions CSV").setInputFiles({ ...sft, buffer });
    await expect(page.getByTestId("file-status")).toHaveText("Imported file: saved in this browser only");
    await expect(page.getByRole("heading", { name: /Message 1 of 48/ })).toBeVisible();

    // Full view: the usual card, with the customer's form available.
    await expect(page.getByText("Jev predicted")).toBeVisible();
    await expect(page.getByText("Show the form the customer would get")).toBeVisible();

    await page.getByRole("group", { name: "What to show" }).getByRole("button", { name: "Fields only" }).click();
    await expect(page.getByText("Extractor output")).toBeVisible();
    await expect(page.getByText("Show the form the customer would get")).toHaveCount(0);
    await expect(page.getByText("blank").first()).toBeVisible();
    // Choice fields (which account) belong to Jev, so the fix-it form has none of them.
    await expect(page.getByLabel("from account")).toHaveCount(0);
  });

  test("reviewed answers download as seed-file lines", async ({ page }) => {
    const buffer = await readFile("e2e/fixtures/examples.jsonl");
    await page.getByLabel("Import predictions CSV").setInputFiles({ ...sft, buffer });
    await expect(page.getByRole("heading", { name: /Message 1 of 48/ })).toBeVisible();
    await page.keyboard.press("y"); // accept the first row as is
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download labels" }).click()]);
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toMatch(/^# \w+\n.+/);
  });
});
