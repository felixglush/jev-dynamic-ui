import "server-only";

import { CATALOG } from "@/lib/jev/catalog";
import { freeTextParams, systemPromptFor, type FreeTextSpec } from "./prompt";

export { freeTextParams, systemPromptFor };

/**
 * Pull the free-text values for one action out of a message with a small local model (Ollama).
 *
 * This only proposes values. Jev still picks the action and chooses among candidates; choice
 * parameters (which account, which card) are Jev's job and are not asked here. Anything the
 * model returns is passed on as is; teaching it to leave absent fields empty is the fine-tuning's job (src/lib/sft).
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "lfm25-350m-sft";
const TIMEOUT_MS = 60_000;

export type ExtractStatus =
  | "kept" // the model gave a value
  | "blank"; // the model left it empty: the message doesn't say

export type ExtractedField = {
  value: string | number | null;
  status: ExtractStatus;
};

const HINTS: Record<FreeTextSpec["type"], string> = {
  name: "a person's or company's name exactly as written in the message",
  email: "an email address exactly as written in the message",
  phone: "a phone number exactly as written in the message",
  account_number: "an account number exactly as written in the message",
  date: "a date or schedule exactly as written in the message, e.g. 'tomorrow' or 'the 15th'",
  amount: "a money amount as a plain number: 200 for 'two hundred dollars', 1500 for '$1.5k'",
};

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

export async function extractFields(
  action: keyof typeof CATALOG,
  message: string,
): Promise<Record<string, ExtractedField>> {
  const params = freeTextParams(action);
  if (params.length === 0) return {};

  // `format` makes Ollama enforce the JSON schema, so the answer is always valid JSON. Ollama writes a schema's
  // keys in alphabetical order, not the catalog order. A model trained in catalog order only (Runs 1 to 5, the
  // first 350M) falls apart under that: 95/129 on the stress set with the schema against 113/129 without, and
  // 54% against 96% exact on val. The model in use is trained on answers with the keys in random order
  // (training/modal_train.py --order-copies 3), so the order does not matter to it. Do not point this at an
  // older GGUF without dropping `format` (docs/sft-experiments.md, "Key order").
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
  for (const [name] of params) {
    const raw = typeof answer[name] === "string" || typeof answer[name] === "number" ? (answer[name] as string | number) : null;
    fields[name] = raw === null || raw === "" || raw === 0 ? { value: null, status: "blank" } : { value: raw, status: "kept" };
  }
  return fields;
}
