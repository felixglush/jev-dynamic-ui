import "server-only";

import { TypeSafeError } from "@typesafe-ai/sdk";

import { MAX_MESSAGE_LENGTH, CATALOG } from "@/lib/jev/catalog";
import { ExtractorDownError, withExtractedFields, type Speculation } from "@/lib/extract/apply";
import { extractFields } from "@/lib/extract/ollama";
import { logPrediction } from "@/lib/annotate/log";
import { classify } from "@/lib/jev/classify";
import type { ClassifyOutcome } from "@/lib/jev/types";

/**
 * One prediction for a message: Jev picks the action and the choices, the local extractor fills the free-text values.
 *
 * `guess` is the action the last prediction for this text picked. While typing, the action rarely changes, so the
 * extractor is started for the guess at the same time as Jev is asked, and the two overlap instead of running one
 * after the other. If Jev then picks another action the guess is thrown away and the right one is extracted.
 * `signal` aborts the extractor call when the customer has typed something newer.
 */
export async function predictMessage(
  message: unknown,
  { sent = false, guess, signal }: { sent?: boolean; guess?: unknown; signal?: AbortSignal } = {},
): Promise<ClassifyOutcome> {
  if (typeof message !== "string") return { ok: false, error: "Message must be text." };
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, error: "Type a message first." };
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` };
  }

  let speculation: Speculation | undefined;
  if (typeof guess === "string" && Object.hasOwn(CATALOG, guess)) {
    const action = guess as keyof typeof CATALOG;
    const fields = extractFields(action, trimmed, signal);
    fields.catch(() => {}); // a guess nobody reads must not become an unhandled rejection
    speculation = { action, fields };
  }

  try {
    const result = await classify(trimmed);
    // The local fine-tuned model fills the free-text fields; without it the system is down (no regex fallback).
    const extraction = await withExtractedFields(result, trimmed, speculation, signal);
    // Only a message the customer sent (Return) is logged; the live guesses made while typing are not.
    if (sent) await logPrediction(trimmed, result, extraction.extracted);
    return { ok: true, result: extraction.result };
  } catch (error) {
    console.error("predictMessage failed:", error);
    const missingKey = error instanceof TypeSafeError && /API key/i.test(error.message);
    if (error instanceof ExtractorDownError) return { ok: false, error: "The extractor (Ollama) isn't reachable, so the assistant is down. Start Ollama and try again." };
    return {
      ok: false,
      error: missingKey
        ? "The server has no TypeSafe API key configured. Set TYPESAFE_API_KEY in .env.local."
        : "Something went wrong classifying that message. Please try again.",
    };
  }
}
