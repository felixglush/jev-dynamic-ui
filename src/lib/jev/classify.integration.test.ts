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
    expect(await classify("what's my chequing balance?", client)).toMatchObject({ action: null });
  });

  it("surfaces API failures as TypeSafeError", async () => {
    await expect(classify("simulate-server-error", client)).rejects.toBeInstanceOf(TypeSafeError);
  });
});
