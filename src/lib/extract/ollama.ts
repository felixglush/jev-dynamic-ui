import "server-only";

import { CATALOG, type ActionSpec, type ParamSpec } from "@/lib/jev/catalog";
import { isGrounded } from "./ground";

/**
 * Pull the free-text values for one action out of a message with a small local model (Ollama).
 *
 * This only proposes values. Jev still picks the action and chooses among candidates; choice
 * parameters (which account, which card) are Jev's job and are not asked here. Anything the
 * model returns that isn't actually written in the message is blanked (see ground.ts).
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "lfm25-230m";
const TIMEOUT_MS = 60_000;

export type ExtractStatus =
  | "kept" // the model's value appears in the message
  | "blank" // the model left it empty: the message doesn't say
  | "dropped"; // the model gave a value that isn't in the message, so it was discarded

export type ExtractedField = {
  value: string | number | null;
  /** What the model returned before checking, kept for evaluation. */
  raw: string | number | null;
  status: ExtractStatus;
};

type FreeTextSpec = Exclude<ParamSpec, { type: "choice" }>;

const HINTS: Record<FreeTextSpec["type"], string> = {
  name: "a person's or company's name exactly as written in the message",
  email: "an email address exactly as written in the message",
  phone: "a phone number exactly as written in the message",
  account_number: "an account number exactly as written in the message",
  date: "a date or schedule exactly as written in the message, e.g. 'tomorrow' or 'the 15th'",
  amount: "a money amount as a plain number: 200 for 'two hundred dollars', 1500 for '$1.5k'",
};

/** The parameters the model is asked for: everything except choices. */
export function freeTextParams(action: keyof typeof CATALOG): [string, FreeTextSpec][] {
  const spec: ActionSpec = CATALOG[action];
  return Object.entries(spec.params).filter((entry): entry is [string, FreeTextSpec] => entry[1].type !== "choice");
}

/** JSON Schema for Ollama's `format` field. Every field is required: the model can't skip one, only leave it empty. */
export function schemaFor(action: keyof typeof CATALOG) {
  const properties: Record<string, object> = {};
  for (const [name, spec] of freeTextParams(action)) {
    properties[name] =
      spec.type === "amount"
        ? { type: "number", description: `${HINTS.amount}; 0 if the message doesn't state one` }
        : { type: "string", description: `${HINTS[spec.type]}; "" if the message doesn't state it` };
  }
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

/** The system prompt the model is given. Exported so the fine-tuning data (src/lib/sft) trains on exactly this text. */
export function systemPromptFor(action: keyof typeof CATALOG): string {
  return (
    `Extract these fields from the user's banking message: ${freeTextParams(action).map(([name]) => name).join(", ")}. ` +
    "Only copy information that is actually written in the message. If a field is not stated, leave it empty. " +
    "Never invent names, emails, phone numbers or dates."
  );
}

export async function extractFields(
  action: keyof typeof CATALOG,
  message: string,
): Promise<Record<string, ExtractedField>> {
  const params = freeTextParams(action);
  if (params.length === 0) return {};

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: schemaFor(action),
      options: { temperature: 0 },
      messages: [
        { role: "system", content: systemPromptFor(action) },
        { role: "user", content: message },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);

  const body = (await response.json()) as { message?: { content?: string } };
  const answer = JSON.parse(body.message?.content ?? "{}") as Record<string, unknown>;

  const fields: Record<string, ExtractedField> = {};
  for (const [name, spec] of params) {
    const raw = typeof answer[name] === "string" || typeof answer[name] === "number" ? (answer[name] as string | number) : null;
    if (raw === null || raw === "" || raw === 0) {
      fields[name] = { value: null, raw, status: "blank" };
    } else if (isGrounded(spec.type, raw, message)) {
      fields[name] = { value: raw, raw, status: "kept" };
    } else {
      fields[name] = { value: null, raw, status: "dropped" };
    }
  }
  return fields;
}
