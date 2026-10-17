/**
 * Integration tests: the real classifier and the real TypeSafe SDK, talking over real HTTP to the
 * local fake Jev server in e2e/fake-jev.mts. They check that Jev is asked only for the action and the
 * choice fields, and what a customer message turns into. Free-text values are the extractor's job
 * (see src/lib/extract) and are covered by the browser tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TypeSafeClient, TypeSafeError } from "@typesafe-ai/sdk";

import { startFakeJev } from "../../../e2e/fake-jev.mts";
import { CATALOG } from "./catalog";
import { classify } from "./classify";
import { normalize } from "./normalize";

let fake: Awaited<ReturnType<typeof startFakeJev>>;
let client: TypeSafeClient;

beforeAll(async () => {
  fake = await startFakeJev();
  // Default compression is left on, as in the real app, so the fake must decode zstd bodies.
  client = new TypeSafeClient({ apiKey: "test-key", baseURL: fake.url, retry: { maxRetries: 0 } });
});
afterAll(() => fake.close());

describe("classify", () => {
  it("asks Jev for the action and the choice fields only, in one round trip", async () => {
    const before = fake.requests.length;
    const result = await classify("Send $50 to Sam for dinner last night", client);

    expect(result).toMatchObject({
      action: "send_etransfer",
      // Free-text fields are left for the extractor; required ones are listed as missing until it runs.
      missing: ["recipient", "amount"],
      params: { recipient: { value: null }, amount: { value: null }, from_account: { value: null } },
    });
    expect(fake.requests.length - before).toBe(1);

    const asked = Object.keys(fake.requests[fake.requests.length - 1]!.questions);
    const expected = ["__action__"];
    for (const [action, spec] of Object.entries(CATALOG)) {
      for (const [param, p] of Object.entries(spec.params)) if (p.type === "choice") expected.push(`${action}.${param}`);
    }
    expect(asked.sort()).toEqual(expected.sort());
  });

  it("fills choice parameters from the catalog options", async () => {
    const result = await classify("pay the minimum on my credit card from savings", client);
    expect(result).toMatchObject({
      action: "pay_credit_card",
      params: { payment_option: { value: "minimum" }, from_account: { value: "savings" }, amount: { value: null } },
    });
  });

  it("returns no action when the message is not a banking action", async () => {
    expect(await classify("what time does the branch close", client)).toMatchObject({ action: null });
  });

  it("surfaces API failures as TypeSafeError", async () => {
    await expect(classify("simulate-server-error", client)).rejects.toBeInstanceOf(TypeSafeError);
  });
});

describe("classify: choices for the other banking actions", () => {
  it("moves money between own accounts on a schedule", async () => {
    expect(await classify("move $300 from chequing to savings every month starting tomorrow", client)).toMatchObject({
      action: "transfer_between_accounts",
      params: { from_account: { value: "chequing" }, to_account: { value: "savings" }, frequency: { value: "monthly" } },
    });
  });

  it("lists the account the customer didn't say as missing", async () => {
    expect(await classify("move 500 to my tfsa", client)).toMatchObject({
      action: "transfer_between_accounts",
      missing: expect.arrayContaining(["from_account"]),
      params: { to_account: { value: "tfsa" } },
    });
  });

  it("schedules a recurring e-Transfer", async () => {
    expect(await classify("send $50 to Sam every week", client)).toMatchObject({
      action: "send_etransfer",
      params: { frequency: { value: "weekly" } },
    });
  });

  it("replaces a stolen card", async () => {
    expect(await classify("my debit card was stolen, please replace it", client)).toMatchObject({
      action: "manage_card",
      params: { card_action: { value: "replace" }, card: { value: "debit" }, reason: { value: "stolen" } },
    });
  });

  it("shows transactions for an account", async () => {
    expect(await classify("show my last 5 transactions in savings", client)).toMatchObject({
      action: "view_account",
      params: { account: { value: "savings" }, view: { value: "transactions" } },
    });
  });

  it("disputes a charge as unrecognized", async () => {
    expect(await classify("I don't recognize a $45.20 charge from Amazon on 2026-10-02", client)).toMatchObject({
      action: "dispute_transaction",
      params: { reason: { value: "unrecognized" } },
    });
  });

  it("updates the customer's own email", async () => {
    expect(await classify("change my email to new.me@example.com", client)).toMatchObject({
      action: "update_contact_info",
      params: { contact_type: { value: "email" } },
    });
  });
});

describe("normalize: cleaning the extractor's values for the forms", () => {
  // A fixed "today" (Friday, 2026-10-16) so relative dates have one right answer.
  const now = new Date(2026, 9, 16);

  it("turns amounts, phones, emails and account numbers into form values", () => {
    expect(normalize("amount", "$5,000.50")).toBe("5000.50");
    expect(normalize("amount", "2k")).toBe("2000.00");
    expect(normalize("phone", "(416) 555-0199")).toBe("4165550199");
    expect(normalize("email", "Priya.K@Example.com")).toBe("priya.k@example.com");
    expect(normalize("account_number", "4471-2290-88")).toBe("4471229088");
  });

  it("turns dates into the next matching day, never today for a weekday", () => {
    expect(normalize("date", "tomorrow", now)).toBe("2026-10-17");
    expect(normalize("date", "friday", now)).toBe("2026-10-23");
    expect(normalize("date", "the 1st", now)).toBe("2026-11-01");
    expect(normalize("date", "March 3, 2027", now)).toBe("2027-03-03");
    expect(normalize("date", "3 March", now)).toBe("2027-03-03");
  });

  it("keeps text that is not a real date as it was written", () => {
    expect(normalize("date", "February 30", now)).toBe("February 30");
  });

  it("finds Feb 29 even when the next one is years away", () => {
    expect(normalize("date", "February 29", new Date(2028, 2, 1))).toBe("2032-02-29");
  });
});
