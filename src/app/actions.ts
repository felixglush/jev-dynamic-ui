"use server";

import { TypeSafeError } from "@typesafe-ai/sdk";

import { MAX_MESSAGE_LENGTH } from "@/lib/jev/catalog";
import { withExtractedFields } from "@/lib/extract/apply";
import { logPrediction } from "@/lib/annotate/log";
import { classify } from "@/lib/jev/classify";
import type { ClassifyOutcome } from "@/lib/jev/types";

/**
 * Server Action: runs on the server when the chat form is submitted, so the API key never leaves it.
 *
 * Server Actions are public POST endpoints, so treat the argument as untrusted input and validate it
 * even though our own form is the only caller we expect. Add authentication here before deploying.
 */
export async function classifyMessage(message: string): Promise<ClassifyOutcome> {
  if (typeof message !== "string") return { ok: false, error: "Message must be text." };
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, error: "Type a message first." };
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` };
  }

  try {
    const result = await classify(trimmed);
    await logPrediction(trimmed, result);
    // EXTRACTOR=ollama: let the local fine-tuned model fill the free-text fields (see README).
    return { ok: true, result: process.env.EXTRACTOR === "ollama" ? await withExtractedFields(result, trimmed) : result };
  } catch (error) {
    // Log the detail on the server; send the browser only a generic message.
    console.error("classifyMessage failed:", error);
    const missingKey = error instanceof TypeSafeError && /API key/i.test(error.message);
    return {
      ok: false,
      error: missingKey
        ? "The server has no TypeSafe API key configured. Set TYPESAFE_API_KEY in .env.local."
        : "Something went wrong classifying that message. Please try again.",
    };
  }
}
