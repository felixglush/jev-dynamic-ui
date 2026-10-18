/**
 * Integration test: the real classifier and the real Laya adapter, over HTTP to a tiny stand-in for
 * scripts/laya/server.py. It checks the questions sent and how Laya's answers become an action call.
 * Says nothing about Laya's accuracy; `npm run compare` measures that against the real model.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";

import { classify } from "./classify";
import { askLaya } from "./laya";

let server: Server;
const requests: { text: string; questions: Record<string, { type: string; criteria: Record<string, string> }> }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const sent = JSON.parse(body) as (typeof requests)[number];
      requests.push(sent);
      const answers = Object.fromEntries(
        Object.keys(sent.questions).map((key) => [
          key,
          { type: "choice", choice: key === "__action__" ? "pay_credit_card" : key.endsWith("pay_from") ? "savings" : "none", confidence: 0.9 },
        ]),
      );
      res.setHeader("content-type", "application/json").end(JSON.stringify({ answers }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.LAYA_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

it("asks the action first, then only that action's choices, and builds the action call", async () => {
  const result = await classify("pay my visa from savings", askLaya);

  expect(requests).toHaveLength(2);
  const [first, second] = requests as [(typeof requests)[number], (typeof requests)[number]];
  expect(first.text).toBe("pay my visa from savings");
  expect(Object.keys(first.questions)).toEqual(["__action__"]);
  expect(Object.keys(first.questions.__action__!.criteria)).toContain("pay_credit_card");
  expect(Object.keys(second.questions).every((key) => key.startsWith("pay_credit_card."))).toBe(true);
  expect(JSON.stringify(requests)).not.toContain("`query`");
  expect(result).toMatchObject({ action: "pay_credit_card", confidence: 0.9 });
});
