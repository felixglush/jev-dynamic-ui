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
const KNOWN_COMPANIES = ["Hydro One", "Rogers", "Amazon"];

function actionFor(query: string): string {
  const text = query.toLowerCase();
  if (/dispute|recognize|charged twice/.test(text)) return "dispute_transaction";
  if (/\b(lock|unlock|freeze|replace)\b.*card|card.*\b(lost|stolen)\b|\b(lost|stolen)\b.*card/.test(text)) return "manage_card";
  if (/auto-?deposit/.test(text)) return "setup_autodeposit";
  if (/cancel.*e-?transfer/.test(text)) return "cancel_etransfer";
  if (/\brequest\b.*\bfrom\b/.test(text)) return "request_etransfer";
  if (/\b(change|update)\b.*\b(address|phone|email)\b/.test(text)) return "update_contact_info";
  if (/\b(balance|transactions)\b/.test(text)) return "view_account";
  if (/\b(add|new)\b.*\b(biller|payee)\b/.test(text)) return "add_payee";
  if (/\bbill\b|hydro|rogers/.test(text)) return "pay_bill";
  if (/\b(move|transfer)\b.*\b(to|into)\b.*\b(savings|chequing|tfsa|rrsp|fhsa)\b/.test(text)) return "transfer_between_accounts";
  if (/credit card|visa|mastercard/.test(text)) return "pay_credit_card";
  if (/\bopen\b|tfsa|rrsp|fhsa/.test(text)) return "open_account";
  if (/\badd\b.*(contact|sister|brother|friend|e-?transfer)/.test(text)) return "add_etransfer_contact";
  if (/\bsend\b|e-?transfer/.test(text)) return "send_etransfer";
  return "none";
}

function pick(question: string, labels: string[], query: string): string {
  const text = query.toLowerCase();
  if (question === "__action__") return actionFor(query);

  const [action, param] = question.split(".");
  const firstWith = (test: (label: string) => boolean) => labels.find(test) ?? "none";
  const optionIn = (words: string[]) => words.find((word) => labels.includes(word) && text.includes(word)) ?? "none";
  if (action === "transfer_between_accounts" && (param === "from_account" || param === "to_account")) {
    const word = new RegExp(param === "from_account" ? "from (?:my )?(\\w+)" : "(?:to|into) (?:my )?(\\w+)").exec(text)?.[1];
    return word && labels.includes(word) ? word : "none";
  }
  switch (param) {
    case "date":
      return labels[0] === "none" ? "none" : labels[0]!;
    case "frequency":
      return /every week|weekly/.test(text) ? "weekly" : /every two weeks|biweekly/.test(text) ? "biweekly" : /every month|monthly/.test(text) ? "monthly" : "none";
    case "payee":
    case "biller":
    case "merchant":
      return firstWith((label) => KNOWN_COMPANIES.includes(label));
    case "account_number":
      return firstWith((label) => label.replace(/\D/g, "").length >= 5);
    case "card_action":
      return /unlock/.test(text) ? "unlock" : /lock|freeze/.test(text) ? "lock" : /replace|lost|stolen/.test(text) ? "replace" : "none";
    case "card":
      return optionIn(["debit", "credit"]);
    case "reason":
      return action === "dispute_transaction"
        ? /recognize/.test(text) ? "unrecognized" : /twice/.test(text) ? "duplicate" : "none"
        : optionIn(["lost", "stolen", "damaged"]);
    case "account":
      return optionIn(["chequing", "savings", "tfsa", "rrsp", "fhsa"]);
    case "view":
      return /transactions/.test(text) ? "transactions" : /balance/.test(text) ? "balance" : "none";
    case "deposit_account":
      return optionIn(["chequing", "savings"]);
    case "contact_type":
      return optionIn(["address", "phone", "email"]);
    case "from_person":
      return firstWith((label) => KNOWN_NAMES.includes(label));
    case "from_email":
    case "new_email":
      return firstWith((label) => label.includes("@"));
    case "new_phone":
      return firstWith((label) => /\d/.test(label));
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
