/**
 * Turn a chat message into an action call: which action, and the value of each of its parameters.
 *
 * Follows TypeSafe's function-calling pattern. Each message is ONE request to Jev that asks, in
 * parallel:
 *   - "__action__": which action should handle the message (or "none"), and
 *   - "<action>.<param>": every CHOICE parameter of EVERY action, speculatively. Jev reads the whole
 *     message; it never writes text, so free-text parameters are left to the extractor.
 * Code then keeps only the answers belonging to the chosen action, so there is a single round trip.
 *
 * `server-only` makes the build fail if a client component ever imports this file, which keeps the
 * API key (read by the TypeSafe client) out of the browser bundle.
 */
import "server-only";

import {
  choice,
  TypeSafeClient,
  type ChoiceResponse,
  type Questions,
  type ResultFor,
  type Question,
} from "@typesafe-ai/sdk";

import { CATALOG, type ParamSpec } from "./catalog";
import type { ActionCall, ActionName, ClassifyResult, ParamValue } from "./types";

const ACTION_QUESTION = "__action__";
const NONE = "none";

/** Shared client. The SDK reads TYPESAFE_API_KEY from the environment; created on first use. */
let sharedClient: TypeSafeClient | undefined;
function getClient(): TypeSafeClient {
  sharedClient ??= new TypeSafeClient();
  return sharedClient;
}

// Object.keys returns plain strings; this restores the narrower key type we know it has.
const ACTION_NAMES = Object.keys(CATALOG) as ActionName[];
const specsOf = (action: ActionName): Record<string, ParamSpec> => CATALOG[action].params;

/** A choice question in a model-neutral shape: the text asked and each option with its description. */
export type ChoiceSpec = { question: string; options: Record<string, string> };

/**
 * Every question asked of the classifier: the action, plus each CHOICE parameter of every action.
 * Free-text values (names, amounts...) are not asked; the extractor fills them.
 * Both classifiers (Jev and Laya) are built from these same specs so they are compared on equal terms.
 */
export function buildQuestionSpecs(): Record<string, ChoiceSpec> {
  const actionOptions: Record<string, string> = {};
  for (const name of ACTION_NAMES) actionOptions[name] = CATALOG[name].description;
  actionOptions[NONE] = "None of these actions; the query asks for something else or no banking action.";

  const specs: Record<string, ChoiceSpec> = {
    [ACTION_QUESTION]: { question: "Which action in the banking app should handle `query`?", options: actionOptions },
  };
  for (const name of ACTION_NAMES) {
    for (const [paramName, spec] of Object.entries(specsOf(name))) {
      if (spec.type !== "choice") continue;
      specs[`${name}.${paramName}`] = {
        question: spec.question,
        options: { ...spec.options, [NONE]: "The query does not give this; none of these is the requested value." },
      };
    }
  }
  return specs;
}

export function buildQuestions(): Questions {
  const questions: Record<string, Question> = {};
  for (const [key, spec] of Object.entries(buildQuestionSpecs())) questions[key] = choice(spec.question, spec.options);
  return questions;
}

/** One answered choice question, whichever model answered it. */
export type ChoiceAnswer = { choice: string; confidence: number };
export type ChoiceAnswers = Record<string, ChoiceAnswer>;

export type Classifier = (query: string) => Promise<ChoiceAnswers>;

/** Jev (TypeSafe API): one request carrying every question. */
export async function askJev(query: string, client: TypeSafeClient = getClient()): Promise<ChoiceAnswers> {
  const { answers } = await client.systemOne({
    // State is what Jev reads; the questions refer to it by field name (`query`).
    state: {
      context: "A customer typed this into the chat box of their bank's mobile app.",
      query,
    },
    questions: buildQuestions(),
  });
  const out: ChoiceAnswers = {};
  for (const [key, answer] of Object.entries(answers as Record<string, ResultFor<Question>>)) {
    if (answer?.type === "choice") out[key] = { choice: (answer as ChoiceResponse).choice, confidence: answer.confidence };
  }
  return out;
}

/**
 * Which model picks the action and the choices: `jev` (default) or `laya`. Set CLASSIFIER in the environment.
 * Laya needs its local server (scripts/laya/server.py); the import is lazy so Jev users never load it.
 */
async function ask(query: string): Promise<ChoiceAnswers> {
  if (process.env.CLASSIFIER === "laya") return (await import("./laya")).askLaya(query);
  return askJev(query);
}

export async function classify(query: string, askFn: Classifier | TypeSafeClient = ask): Promise<ClassifyResult> {
  const answers = typeof askFn === "function" ? await askFn(query) : await askJev(query, askFn);

  const picked = answers[ACTION_QUESTION];
  if (!picked) throw new Error("The classifier returned no answer for the action question");
  if (picked.choice === NONE) return { action: null, confidence: picked.confidence };

  const action = picked.choice as ActionName;
  const params: Record<string, ParamValue> = {};
  const missing: string[] = [];

  for (const [paramName, spec] of Object.entries(specsOf(action))) {
    // Free-text parameters were not asked; the extractor fills them in (extract/apply.ts).
    const answer = spec.type === "choice" ? answers[`${action}.${paramName}`] : undefined;
    if (!answer || answer.choice === NONE) {
      params[paramName] = { value: null, confidence: answer?.confidence ?? null };
      if ("required" in spec && spec.required) missing.push(paramName);
    } else {
      params[paramName] = { value: answer.choice, confidence: answer.confidence };
    }
  }

  // The per-action types are precise, but we built `params` generically, so assert once here.
  // The result shape is exercised by classify.test.ts.
  return { action, confidence: picked.confidence, params, missing } as ActionCall;
}
