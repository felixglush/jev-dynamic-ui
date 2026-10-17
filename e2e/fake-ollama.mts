/**
 * A local stand-in for Ollama, used by the browser tests.
 *
 * The real extractor talks to it over real HTTP (POST /api/chat with a JSON-schema `format`), so
 * these tests exercise our request building, the server action and the UI. The "model" is a few
 * rules, so passing tests say nothing about how well LiquidFM reads messages.
 *
 * `POST /__mode` with `{"fail": true}` makes every chat call return 500, to test the error path.
 * Run standalone with `node e2e/fake-ollama.mts` (the Playwright config does this).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

const PORT = Number(process.env.FAKE_OLLAMA_PORT ?? 0);
let failing = false;

const KNOWN = ["landlord", "Sam", "Priya", "Jordan", "María-José", "Hydro One", "Rogers", "Amazon"];

/**
 * Fill each field the request's schema asks for, the way a careful reader would for the messages the tests use:
 * names and companies from a short list (so "somebody" stays blank), "2k" as 2000, ISO dates, emails, phones and
 * account numbers as written.
 */
function answer(properties: Record<string, { type: string }>, message: string) {
  const result: Record<string, string | number> = {};
  for (const [name, { type }] of Object.entries(properties)) {
    if (type === "number") {
      const thousands = /(\d[\d,]*(?:\.\d+)?)\s*k\b/i.exec(message)?.[1];
      const dollars = /\$\s?(\d[\d,]*(?:\.\d+)?)/.exec(message)?.[1];
      const plain = /(?<![\d-])(\d[\d,]*(?:\.\d+)?)(?![\d-])/.exec(message)?.[1];
      result[name] = thousands ? Number(thousands.replaceAll(",", "")) * 1000 : Number((dollars ?? plain ?? "0").replaceAll(",", ""));
    } else if (name.includes("email")) {
      result[name] = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(message)?.[0] ?? "";
    } else if (name.includes("phone")) {
      result[name] = /\+?\d[\d\s().-]{8,}\d/.exec(message)?.[0] ?? "";
    } else if (name.includes("date")) {
      result[name] = /\d{4}-\d{2}-\d{2}/.exec(message)?.[0] ?? "";
    } else if (name.includes("account")) {
      result[name] = /\d{4}-\d{4}-\d{2}|\d{5,}/.exec(message)?.[0] ?? "";
    } else {
      // Copied as written in the message ("jordan" stays "jordan"), like a model told to copy.
      const lower = message.toLowerCase();
      const found = KNOWN.map((known) => ({ known, at: lower.indexOf(known.toLowerCase()) })).find(({ at }) => at !== -1);
      const at = found && message.slice(found.at, found.at + found.known.length);
      result[name] = at ?? "";
    }
  }
  return result;
}

const server = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "POST") return send(200, { ok: true });
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (request.url === "/__mode") {
      failing = Boolean(body.fail);
      return send(200, { failing });
    }
    if (request.url !== "/api/chat") return send(404, { error: "not found" });
    if (failing) return send(500, { error: "the fake Ollama is set to fail" });
    const message = [...(body.messages ?? [])].reverse().find((m: { role: string }) => m.role === "user")?.content ?? "";
    send(200, { message: { role: "assistant", content: JSON.stringify(answer(body.format?.properties ?? {}, message)) } });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake Ollama listening on ${(server.address() as AddressInfo).port}`);
});
