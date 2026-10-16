/**
 * What the extractor asks the model, kept apart from ollama.ts (which is server-only) so the
 * fine-tuning code and the annotate page, which also run in the browser, can share it.
 */
import { CATALOG, type ActionSpec, type ParamSpec } from "@/lib/jev/catalog";

/** A choice the model copies as text (`extract` in the catalog) becomes a "text" field with that hint. */
export type FreeTextSpec =
  | Exclude<ParamSpec, { type: "choice" }>
  | { type: "text"; question: string; required?: boolean; hint: string };

/** The parameters the model is asked for: everything except choices, plus choices marked `extract`. */
export function freeTextParams(action: keyof typeof CATALOG): [string, FreeTextSpec][] {
  const spec: ActionSpec = CATALOG[action];
  return Object.entries(spec.params).flatMap(([name, param]): [string, FreeTextSpec][] => {
    if (param.type !== "choice") return [[name, param]];
    return param.extract ? [[name, { type: "text", question: param.question, required: param.required, hint: param.extract }]] : [];
  });
}

/** The system prompt the model is given. Fine-tuning data (src/lib/sft) trains on exactly this text. */
export function systemPromptFor(action: keyof typeof CATALOG): string {
  return (
    `Extract these fields from the user's banking message: ${freeTextParams(action).map(([name]) => name).join(", ")}. ` +
    "Only copy information that is actually written in the message. If a field is not stated, leave it empty. " +
    "Never invent names, emails, phone numbers or dates."
  );
}
