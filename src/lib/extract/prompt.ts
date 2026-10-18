/**
 * What the extractor asks the model, kept apart from ollama.ts (which is server-only) so the
 * fine-tuning code and the annotate page, which also run in the browser, can share it.
 */
import { CATALOG, type ActionSpec, type ParamSpec } from "@/lib/jev/catalog";

export type FreeTextSpec = Exclude<ParamSpec, { type: "choice" }>;

/** The parameters the model is asked for: everything except choices. */
export function freeTextParams(action: keyof typeof CATALOG): [string, FreeTextSpec][] {
  const spec: ActionSpec = CATALOG[action];
  return Object.entries(spec.params).filter((entry): entry is [string, FreeTextSpec] => entry[1].type !== "choice");
}

/** The system prompt the model is given. Fine-tuning data (src/lib/sft) trains on exactly this text. */
export function systemPromptFor(action: keyof typeof CATALOG): string {
  return (
    `Extract these fields from the user's banking message: ${freeTextParams(action).map(([name]) => name).join(", ")}. ` +
    "Only copy information that is actually written in the message. If a field is not stated, leave it empty. " +
    "Never invent names, emails, phone numbers or dates."
  );
}

/** Every answer the action step can give: the catalog's actions plus "none" for a message none of them fits. */
export function actionNames(): string[] {
  return [...Object.keys(CATALOG), "none"];
}

/** The system prompt of the action step (experiment: the extractor model picks the action instead of Jev). */
export function actionPrompt(): string {
  return (
    `Pick the one banking action the customer's message asks for. Actions: ${actionNames().join(", ")}. ` +
    "Answer none if the message asks for none of them."
  );
}
