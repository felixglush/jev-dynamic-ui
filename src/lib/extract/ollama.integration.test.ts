/**
 * Integration tests: the real extractor talking real HTTP to a stand-in Ollama server that returns
 * canned model answers. They prove the request shape and the grounding. They say nothing about how
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
    // from_account and frequency are choices, which Jev answers, so they aren't asked here.
    expect(Object.keys(request!.format.properties)).toEqual(["recipient", "recipient_email", "amount", "date"]);
    expect(request!.format.required).toEqual(["recipient", "recipient_email", "amount", "date"]);
    expect(request!.messages.at(-1)!.content).toBe("Send $50 to Sam for dinner");
  });

  it("keeps values that are in the message and leaves the rest blank", async () => {
    answer = { recipient: "Sam", recipient_email: "", amount: 50, date: "" };
    const fields = await extractFields("send_etransfer", "Send $50 to Sam for dinner");
    expect(fields.recipient).toMatchObject({ value: "Sam", status: "kept" });
    expect(fields.amount).toMatchObject({ value: 50, status: "kept" });
    expect(fields.recipient_email).toMatchObject({ value: null, status: "blank" });
  });

  it("drops invented values instead of filling the form with them", async () => {
    answer = { recipient: "John Doe", recipient_email: "sam@example.com", amount: 50, date: "2023-10-05" };
    const fields = await extractFields("send_etransfer", "Send $50 to Sam");
    expect(fields.recipient).toMatchObject({ value: null, raw: "John Doe", status: "dropped" });
    expect(fields.recipient_email).toMatchObject({ value: null, status: "dropped" });
    expect(fields.date).toMatchObject({ value: null, status: "dropped" });
    expect(fields.amount).toMatchObject({ value: 50, status: "kept" });
  });

  it("accepts spelled-out and shorthand amounts, and accented names", async () => {
    answer = { recipient: "Chloé", recipient_email: "", amount: 75, date: "" };
    expect((await extractFields("send_etransfer", "etransfer seventy-five dollars to Chloé")).amount!.value).toBe(75);
    answer = { recipient: "Noah", recipient_email: "", amount: 1500, date: "" };
    expect((await extractFields("send_etransfer", "send $1.5k to Noah")).amount!.value).toBe(1500);
    answer = { recipient: "Sam", recipient_email: "", amount: 200, date: "" };
    expect((await extractFields("send_etransfer", "send two hundred dollars to Sam")).amount!.value).toBe(200);
  });

  it("rejects an amount the message doesn't state, even a plausible one", async () => {
    answer = { recipient: "", recipient_email: "", amount: 200, date: "" };
    const fields = await extractFields("send_etransfer", "send money to Chris");
    expect(fields.amount).toMatchObject({ value: null, status: "dropped" });
  });

  it("matches phone numbers by digits, whatever the punctuation", async () => {
    answer = { name: "Zoë", email: "", phone: "4165550123" };
    const fields = await extractFields("add_etransfer_contact", "save Zoë's number (416) 555-0123");
    expect(fields.phone).toMatchObject({ value: "4165550123", status: "kept" });
    expect(fields.name).toMatchObject({ value: "Zoë", status: "kept" });
  });

  it("makes no request for an action with only choice parameters", async () => {
    expect(await extractFields("manage_card", "lock my debit card")).toEqual({});
    expect(requests).toHaveLength(0);
  });
});
