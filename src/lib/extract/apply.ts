import "server-only";

import { CATALOG } from "@/lib/jev/catalog";
import { normalize } from "@/lib/jev/candidates";
import type { ClassifyResult } from "@/lib/jev/types";
import { extractFields } from "./ollama";

/**
 * Replace Jev's free-text values with the local extractor's. Jev still picks the action and the
 * choice parameters; for names, emails, phones, amounts and dates the extractor's answer wins, and a
 * blank answer stays blank so the form highlights the field. If Ollama is down the result is returned unchanged.
 */
export async function withExtractedFields(result: ClassifyResult, message: string): Promise<ClassifyResult> {
  if (result.action === null) return result;
  let fields;
  try {
    fields = await extractFields(result.action, message);
  } catch (error) {
    console.error("extractor failed, keeping Jev's values:", error);
    return result;
  }
  const specs = CATALOG[result.action].params as Record<string, { type: "choice" | "name" | "email" | "phone" | "amount" | "date" | "account_number"; required?: boolean }>;
  const params = { ...result.params } as Record<string, { value: string | null; confidence: number | null }>;
  for (const [name, field] of Object.entries(fields)) {
    const spec = specs[name];
    // Same normalizing as Jev's values (dates to ISO, phones to digits), so the form fields accept them.
    params[name] = { value: field.value === null || !spec ? null : normalize(spec.type, String(field.value)), confidence: null };
  }
  // A required field the extractor left blank is missing now, whatever Jev found.
  const missing = Object.entries(specs)
    .filter(([name, spec]) => spec.required && params[name]?.value === null)
    .map(([name]) => name);
  return { ...result, params, missing } as ClassifyResult;
}
