/**
 * A local stand-in for the TypeSafe API, used by the integration and browser tests.
 *
 * The real SDK talks to it over real HTTP, so these tests exercise our question building, the
 * request/response wiring, the server action and the UI. The "model" is a crude rule set keyed on the
 * message text, so passing tests say nothing about how accurate Jev itself is. It does enforce one
 * real contract: a pick must be one of the labels the request offered, so a test fails if the code
 * ever stops offering the right candidate.
 *
 * Run standalone with `node e2e/fake-jev.mts` (the Playwright config does this).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { zstdDecompressSync } from "node:zlib";

type SentQuestion = { type: string; criteria: Record<string, unknown> };
type Sent = { state: { query: string }; questions: Record<string, SentQuestion> };

const KNOWN_NAMES = ["Sam", "Priya", "Jordan", "jordan", "María-José"];

function actionFor(query: string): string {
  const text = query.toLowerCase();
  if (/credit card|visa|mastercard/.test(text)) return "pay_credit_card";
  if (/\bopen\b|tfsa|rrsp|fhsa/.test(text)) return "open_account";
  if (/\badd\b.*(contact|sister|brother|friend|e-?transfer)/.test(text)) return "add_etransfer_contact";
  if (/\bsend\b|e-?transfer/.test(text)) return "send_etransfer";
  return "none";
}

function pick(question: string, labels: string[], query: string): string {
  const text = query.toLowerCase();
  if (question === "__action__") return actionFor(query);

  const param = question.split(".")[1];
  const firstWith = (test: (label: string) => boolean) => labels.find(test) ?? "none";
  switch (param) {
    case "from_account":
      return text.includes("savings") ? "savings" : text.includes("chequing") ? "chequing" : "none";
    case "payment_option":
      return text.includes("minimum") ? "minimum" : text.includes("pay off") ? "full_balance" : "none";
    case "account_type":
      return ["tfsa", "rrsp", "fhsa"].find((kind) => text.includes(kind)) ?? "none";
    case "email":
    case "recipient_email":
      return firstWith((label) => label.includes("@"));
    case "amount":
    case "initial_deposit":
    case "phone":
      return firstWith((label) => /\d/.test(label));
    case "name":
    case "recipient":
      return firstWith((label) => KNOWN_NAMES.includes(label));
    default:
      return "none";
  }
}

/** Confidence the fake reports; amounts are deliberately "unsure" so the UI's warning path is covered. */
const confidenceFor = (question: string) => (question.endsWith("amount") ? 0.55 : 0.93);

function handle(body: Sent): { status: number; payload: unknown } {
  const { query } = body.state;
  // A hook for tests of the failure path.
  if (query.includes("simulate-server-error")) return { status: 500, payload: { error: "boom" } };

  const answers: Record<string, unknown> = {};
  for (const [name, question] of Object.entries(body.questions)) {
    const labels = Object.keys(question.criteria);
    const choice = pick(name, labels, query);
    if (choice !== "none" && !labels.includes(choice)) {
      return { status: 400, payload: { error: `"${choice}" was not offered for ${name}: ${labels.join(" | ")}` } };
    }
    answers[name] = {
      type: "choice",
      choice,
      confidence: confidenceFor(name),
      probabilities: Object.fromEntries(labels.map((label) => [label, label === choice ? 1 : 0])),
    };
  }
  return { status: 200, payload: { model: "fake", usage: { input_tokens: 1, output_tokens: 1 }, answers } };
}

export function startFakeJev(port = 0): Promise<{ url: string; close: () => Promise<void>; requests: Sent[] }> {
  const requests: Sent[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      // The SDK compresses request bodies of 1 KiB or more with zstd, as the real API accepts.
      let raw = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "zstd") raw = zstdDecompressSync(raw);
      const body = JSON.parse(raw.toString()) as Sent;
      requests.push(body);
      const { status, payload } = handle(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const { port: actual } = server.address() as AddressInfo;
      resolve({
        url: `http://localhost:${actual}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

// Started directly (not imported): listen on a fixed port until killed.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startFakeJev(Number(process.env.FAKE_JEV_PORT ?? 8787));
  console.log(`fake Jev listening on ${url}`);
}
