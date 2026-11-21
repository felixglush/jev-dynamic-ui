"use server";

import { predictMessage } from "@/lib/jev/predict";
import type { ClassifyOutcome } from "@/lib/jev/types";

/**
 * Server Action kept for callers that don't need to cancel: runs a prediction on the server so the API key never
 * leaves it. The chat itself uses the abortable route in app/api/classify/route.ts. Server Actions are public POST
 * endpoints, so the argument is untrusted. Add authentication here before deploying.
 */
export async function classifyMessage(message: string, sent = false): Promise<ClassifyOutcome> {
  return predictMessage(message, { sent });
}
