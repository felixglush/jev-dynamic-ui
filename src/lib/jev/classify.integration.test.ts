/**
 * Integration tests: the real classifier and the real TypeSafe SDK, talking over real HTTP to the
 * local fake Jev server in e2e/fake-jev.mts. They cover question building, candidate finding, answer
 * handling and normalizing together, by checking what a customer message turns into.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TypeSafeClient, TypeSafeError } from "@typesafe-ai/sdk";

import { startFakeJev } from "../../../e2e/fake-jev.mts";
import { classify } from "./classify";

let fake: Awaited<ReturnType<typeof startFakeJev>>;
let client: TypeSafeClient;

beforeAll(async () => {
  fake = await startFakeJev();
  // Default compression is left on, as in the real app, so the fake must decode zstd bodies.
  client = new TypeSafeClient({ apiKey: "test-key", baseURL: fake.url, retry: { maxRetries: 0 } });
});
afterAll(() => fake.close());

describe("classify", () => {
  it("turns a plain send request into a filled e-Transfer, in one round trip", async () => {
    const before = fake.requests.length;
    const result = await classify("Send $50 to Sam for dinner last night", client);

    expect(result).toMatchObject({
      action: "send_etransfer",
      missing: [],
      params: { recipient: { value: "Sam" }, amount: { value: "50.00", confidence: 0.55 }, from_account: { value: null } },
    });
    expect(fake.requests.length - before).toBe(1);
  });

  it("understands casual amounts and lowercase names", async () => {
    const result = await classify("etransfer jordan 120 bucks for the concert tickets", client);
    expect(result).toMatchObject({
      action: "send_etransfer",
      params: { recipient: { value: "jordan" }, amount: { value: "120.00" } },
    });
  });

  it("picks the email out of a message when adding a contact", async () => {
    const result = await classify("add my sister Priya, Priya.K@example.com, so I can e-transfer her", client);
    expect(result).toMatchObject({
      action: "add_etransfer_contact",
      missing: [],
      params: { name: { value: "Priya" }, email: { value: "priya.k@example.com" }, phone: { value: null } },
    });
  });

  it("fills choice parameters from the catalog options", async () => {
    const result = await classify("pay the minimum on my credit card from savings", client);
    expect(result).toMatchObject({
      action: "pay_credit_card",
      params: { payment_option: { value: "minimum" }, from_account: { value: "savings" }, amount: { value: null } },
    });
  });

  it("reads shorthand amounts like 2k", async () => {
    const result = await classify("I want to open a TFSA and put 2k in it", client);
    expect(result).toMatchObject({
      action: "open_account",
      params: { account_type: { value: "tfsa" }, initial_deposit: { value: "2000.00" } },
    });
  });

  it("keeps accented and hyphenated names whole so they can be picked", async () => {
    const result = await classify("send $5,000.50 to María-José", client);
    expect(result).toMatchObject({
      action: "send_etransfer",
      missing: [],
      params: { recipient: { value: "María-José" }, amount: { value: "5000.50" } },
    });
  });

  it("lists required parameters the message did not give", async () => {
    const result = await classify("send $20 to somebody", client);
    expect(result).toMatchObject({ action: "send_etransfer", missing: ["recipient"] });
  });

  it("returns no action when the message is not a banking action", async () => {
    expect(await classify("what time does the branch close", client)).toMatchObject({ action: null });
  });

  it("surfaces API failures as TypeSafeError", async () => {
    await expect(classify("simulate-server-error", client)).rejects.toBeInstanceOf(TypeSafeError);
  });
});

describe("classify: banking actions beyond e-Transfers", () => {
  // A fixed "today" (Friday, 2026-10-16) so relative dates like "tomorrow" have one right answer.
  const now = new Date(2026, 9, 16);
  const ask = (query: string) => classify(query, client, now);

  it("moves money between own accounts, with a repeat and a start date", async () => {
    expect(await ask("move $300 from chequing to savings every month starting tomorrow")).toMatchObject({
      action: "transfer_between_accounts",
      missing: [],
      params: {
        from_account: { value: "chequing" },
        to_account: { value: "savings" },
        amount: { value: "300.00" },
        frequency: { value: "monthly" },
        date: { value: "2026-10-17" },
      },
    });
  });

  it("lists the account the customer didn't say as missing", async () => {
    expect(await ask("move 500 to my tfsa")).toMatchObject({
      action: "transfer_between_accounts",
      missing: ["from_account"],
      params: { to_account: { value: "tfsa" }, amount: { value: "500.00" } },
    });
  });

  it("pays a bill on a day of the month, picking the next one", async () => {
    expect(await ask("pay my Hydro One bill $112.30 on the 1st")).toMatchObject({
      action: "pay_bill",
      params: { payee: { value: "Hydro One" }, amount: { value: "112.30" }, date: { value: "2026-11-01" } },
    });
    // Today is the 16th, and a day that hasn't passed yet still counts.
    expect(await ask("pay Rogers $85 on the 16th")).toMatchObject({ params: { date: { value: "2026-10-16" } } });
  });

  it("reads weekday names as the next one coming, never today", async () => {
    expect(await ask("pay Rogers $85 on friday")).toMatchObject({ params: { date: { value: "2026-10-23" } } });
    expect(await ask("pay Rogers $85 on monday")).toMatchObject({ params: { date: { value: "2026-10-19" } } });
  });

  it("reads written-out dates, with or without a year", async () => {
    expect(await ask("pay Rogers $85 on March 3, 2027")).toMatchObject({ params: { date: { value: "2027-03-03" } } });
    expect(await ask("pay Rogers $85 on 3 March")).toMatchObject({ params: { date: { value: "2027-03-03" } } });
    expect(await ask("pay Rogers $85 on 2026-12-24")).toMatchObject({ params: { date: { value: "2026-12-24" } } });
  });

  it("offers no date when the text only looks like one", async () => {
    expect(await ask("pay Rogers $85 on February 30")).toMatchObject({ action: "pay_bill", params: { date: { value: null } } });
  });

  it("schedules a recurring e-Transfer", async () => {
    expect(await ask("send $50 to Sam every week")).toMatchObject({
      action: "send_etransfer",
      params: { recipient: { value: "Sam" }, frequency: { value: "weekly" }, date: { value: null } },
    });
  });

  it("adds a payee and keeps only the digits of the account number", async () => {
    expect(await ask("add Rogers as a payee, my account number is 4471-2290-88")).toMatchObject({
      action: "add_payee",
      missing: [],
      params: { biller: { value: "Rogers" }, account_number: { value: "4471229088" } },
    });
  });

  it("replaces a stolen card", async () => {
    expect(await ask("my debit card was stolen, please replace it")).toMatchObject({
      action: "manage_card",
      params: { card_action: { value: "replace" }, card: { value: "debit" }, reason: { value: "stolen" } },
    });
  });

  it("shows transactions for an account", async () => {
    expect(await ask("show my last 5 transactions in savings")).toMatchObject({
      action: "view_account",
      params: { account: { value: "savings" }, view: { value: "transactions" } },
    });
  });

  it("requests money from a person", async () => {
    expect(await ask("request $75 from Sam")).toMatchObject({
      action: "request_etransfer",
      missing: [],
      params: { from_person: { value: "Sam" }, amount: { value: "75.00" } },
    });
  });

  it("cancels an e-Transfer to a person", async () => {
    expect(await ask("cancel the e-transfer I sent to Priya")).toMatchObject({
      action: "cancel_etransfer",
      params: { recipient: { value: "Priya" } },
    });
  });

  it("turns on autodeposit into an account for an email address", async () => {
    expect(await ask("turn on autodeposit for me.work@example.com into savings")).toMatchObject({
      action: "setup_autodeposit",
      missing: [],
      params: { deposit_account: { value: "savings" }, email: { value: "me.work@example.com" } },
    });
  });

  it("disputes a charge with its merchant, amount, date and reason", async () => {
    expect(await ask("I don't recognize a $45.20 charge from Amazon on 2026-10-02")).toMatchObject({
      action: "dispute_transaction",
      missing: [],
      params: {
        merchant: { value: "Amazon" },
        amount: { value: "45.20" },
        date: { value: "2026-10-02" },
        reason: { value: "unrecognized" },
      },
    });
  });

  it("finds Feb 29 even when the next one is years away", async () => {
    // From March 2028 the next Feb 29 is in 2032.
    const result = await classify("pay Rogers $85 on February 29", client, new Date(2028, 2, 1));
    expect(result).toMatchObject({ params: { date: { value: "2032-02-29" } } });
  });

  it("requests money by email alone, without a name", async () => {
    expect(await ask("request $75 from jordan.k@example.com")).toMatchObject({
      action: "request_etransfer",
      missing: [],
      params: { from_email: { value: "jordan.k@example.com" }, from_person: { value: null } },
    });
  });

  it("updates the customer's own email", async () => {
    expect(await ask("change my email to new.me@example.com")).toMatchObject({
      action: "update_contact_info",
      params: { contact_type: { value: "email" }, new_email: { value: "new.me@example.com" } },
    });
  });
});
