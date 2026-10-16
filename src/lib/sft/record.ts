/**
 * Turn a labeled example into one supervised fine-tuning record.
 *
 * The record is the same conversation the extractor sends to Ollama (see extractFields): the system
 * prompt from systemPromptFor, then the customer's message, and the assistant's answer is the JSON
 * object the schema asks for. The schema itself is not in the text: Ollama enforces it while
 * decoding (`format`), so the model only has to learn the values. Training on exactly what it will
 * see at run time is the point; any wording drift between the two would quietly weaken the tuning.
 */
import { freeTextParams, systemPromptFor } from "@/lib/extract/ollama";
import type { LabeledExample } from "./seed";

export type SftRecord = {
  /** The column trainers read (TRL, Unsloth, Axolotl "chat_template" datasets). */
  messages: [
    { role: "system"; content: string },
    { role: "user"; content: string },
    { role: "assistant"; content: string },
  ];
  /** Bookkeeping for review and splits. Drop it, or select only `messages`, when training. */
  meta: { id: string; action: string; vague: boolean; present: string[] };
};

/** The answer for one example: every field, in schema order, with "" (or 0 for amounts) where the message doesn't say. */
export function targetFor(example: LabeledExample): Record<string, string | number> {
  const target: Record<string, string | number> = {};
  for (const [name, spec] of freeTextParams(example.action)) {
    target[name] = example.fields[name] ?? (spec.type === "amount" ? 0 : "");
  }
  return target;
}

export function toRecord(example: LabeledExample): SftRecord {
  return {
    messages: [
      { role: "system", content: systemPromptFor(example.action) },
      { role: "user", content: example.message },
      { role: "assistant", content: JSON.stringify(targetFor(example)) },
    ],
    meta: { id: example.id, action: example.action, vague: example.vague, present: Object.keys(example.fields) },
  };
}
