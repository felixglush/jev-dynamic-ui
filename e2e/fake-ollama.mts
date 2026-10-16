/**
 * A local stand-in for Ollama, used by the browser tests.
 *
 * The real extractor talks to it over real HTTP (POST /api/chat with a JSON-schema `format`), so
 * these tests exercise our request building, the server action and the UI. The "model" is a few
 * regular expressions, so passing tests say nothing about how well LiquidFM reads messages.
 *
 * `POST /__mode` with `{"fail": true}` makes every chat call return 500, to test the error path.
 * Run standalone with `node e2e/fake-ollama.mts` (the Playwright config does this).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

const PORT = Number(process.env.FAKE_OLLAMA_PORT ?? 0);
let failing = false;

/** Fill each field the request's schema asks for, the way a (very) literal reader would. */
function answer(properties: Record<string, { type: string }>, message: string) {
  const result: Record<string, string | number> = {};
  for (const [name, { type }] of Object.entries(properties)) {
    if (type === "number") {
      result[name] = Number(/\$?(\d[\d,]*(?:\.\d+)?)/.exec(message)?.[1]?.replaceAll(",", "") ?? 0);
    } else if (name.includes("email")) {
      result[name] = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(message)?.[0] ?? "";
    } else if (name.includes("phone")) {
      result[name] = /\+?\d[\d\s().-]{8,}\d/.exec(message)?.[0] ?? "";
    } else if (["name", "recipient", "payee", "biller"].includes(name)) {
      result[name] = /\b(?:to|etransfer|send|pay)\s+(?:my\s+)?(?!\$|\d)([A-Za-z][\w.'-]*)/i.exec(message)?.[1] ?? "";
    } else {
      result[name] = "";
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
