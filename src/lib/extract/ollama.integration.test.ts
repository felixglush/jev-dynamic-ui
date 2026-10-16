/**
 * Integration tests: the real extractor talking real HTTP to a stand-in Ollama server that returns
 * canned model answers. They prove the request shape and how answers are read. They say nothing about how
 * accurate the real model is: run `npm run extract:eval` against a real Ollama for that.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let server: Server;
let requests: { format: { properties: Record<string, unknown>; required: string[] }; messages: { content: string }[] }[];
let answer: unknown;
let extractFields: typeof import("./ollama").extractFields;

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      requests.push(JSON.parse(data));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: { content: JSON.stringify(answer) } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("OLLAMA_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  ({ extractFields } = await import("./ollama"));
});
afterAll(() => server.close());
beforeEach(() => {
  requests = [];
});

describe("extractFields", () => {
  it("asks only for the action's free-text fields, with a schema Ollama can enforce", async () => {
    answer = { recipient: "Sam", recipient_email: "", amount: 50, date: "" };
    await extractFields("send_etransfer", "Send $50 to Sam for dinner");
    const [request] = requests;
    // frequency is a choice, which Jev answers, so it isn't asked here. from_account is a choice the model also copies as text.
    const fields = ["recipient", "recipient_email", "amount", "from_account", "date"];
    expect(Object.keys(request!.format.properties)).toEqual(fields);
    expect(request!.format.required).toEqual(fields);
    expect(request!.messages.at(-1)!.content).toBe("Send $50 to Sam for dinner");
  });

  it("also asks for the source account as text", async () => {
    answer = { amount: 0, from_account: "savings" };
    const fields = await extractFields("pay_credit_card", "pay the minimum on my card from savings");
    // payment_option (minimum, statement balance, ...) is Jev's pick, so it isn't asked here.
    expect(Object.keys(requests.at(-1)!.format.properties)).toEqual(["amount", "from_account"]);
    expect(fields.from_account).toEqual({ value: "savings", status: "kept" });
    expect(fields.amount).toEqual({ value: null, status: "blank" });
  });

  it("passes the model's values on and marks empty ones blank", async () => {
    answer = { recipient: "Sam", recipient_email: "", amount: 50, date: "" };
    const fields = await extractFields("send_etransfer", "Send $50 to Sam for dinner");
    expect(fields.recipient).toEqual({ value: "Sam", status: "kept" });
    expect(fields.amount).toEqual({ value: 50, status: "kept" });
    expect(fields.recipient_email).toEqual({ value: null, status: "blank" });
    expect(fields.date).toEqual({ value: null, status: "blank" });
  });

  it("treats a missing amount (0) and a missing field as blank", async () => {
    answer = { payee: "Bell" };
    const fields = await extractFields("pay_bill", "pay Bell");
    expect(fields.payee).toEqual({ value: "Bell", status: "kept" });
    expect(fields.amount).toEqual({ value: null, status: "blank" });
    answer = { payee: "", amount: 0, date: "" };
    expect((await extractFields("pay_bill", "pay my bills")).amount).toEqual({ value: null, status: "blank" });
  });

  it("makes no request for an action with only choice parameters", async () => {
    expect(await extractFields("manage_card", "lock my debit card")).toEqual({});
    expect(requests).toHaveLength(0);
  });
});
