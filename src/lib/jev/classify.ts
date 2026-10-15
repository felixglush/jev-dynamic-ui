/**
 * Turn a chat message into an action call: which action, and the value of each of its parameters.
 *
 * Follows TypeSafe's function-calling pattern. Each message is ONE request to Jev that asks, in
 * parallel:
 *   - "__action__": which action should handle the message (or "none"), and
 *   - "<action>.<param>": every parameter of EVERY action, speculatively.
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
import { FINDERS, normalize } from "./candidates";
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

function paramQuestion(spec: ParamSpec, query: string): Question | null {
  let options: Record<string, string | null>;
  if (spec.type === "choice") {
    options = { ...spec.options };
  } else {
    const found = FINDERS[spec.type](query);
    // Nothing to pick from, so the value is simply absent. No question needed.
    if (found.length === 0) return null;
    options = Object.fromEntries(found.map((span) => [span, null]));
  }
  options[NONE] = "The query does not give this; none of these is the requested value.";
  return choice(spec.question, options);
}

export function buildQuestions(query: string): Questions {
  const actionOptions: Record<string, string | null> = {};
  for (const name of ACTION_NAMES) actionOptions[name] = CATALOG[name].description;
  actionOptions[NONE] =
    "None of these actions; the query asks for something else or no banking action.";

  const questions: Record<string, Question> = {
    [ACTION_QUESTION]: choice("Which action in the banking app should handle `query`?", actionOptions),
  };
  for (const name of ACTION_NAMES) {
    for (const [paramName, spec] of Object.entries(specsOf(name))) {
      const question = paramQuestion(spec, query);
      if (question) questions[`${name}.${paramName}`] = question;
    }
  }
  return questions;
}

type Answers = Record<string, ResultFor<Question>>;

/** Answers are a union of choice/noul/score/box shapes; this narrows one to a choice. */
function choiceAnswer(answers: Answers, key: string): ChoiceResponse | undefined {
  const answer = answers[key];
  return answer?.type === "choice" ? answer : undefined;
}

export async function classify(
  query: string,
  client: TypeSafeClient = getClient(),
): Promise<ClassifyResult> {
  const { answers } = await client.systemOne({
    // State is what Jev reads; the questions refer to it by field name (`query`).
    state: {
      context: "A customer typed this into the chat box of their bank's mobile app.",
      query,
    },
    questions: buildQuestions(query),
  });

  const picked = choiceAnswer(answers, ACTION_QUESTION);
  if (!picked) throw new Error("Jev returned no answer for the action question");
  if (picked.choice === NONE) return { action: null, confidence: picked.confidence };

  const action = picked.choice as ActionName;
  const params: Record<string, ParamValue> = {};
  const missing: string[] = [];

  for (const [paramName, spec] of Object.entries(specsOf(action))) {
    const answer = choiceAnswer(answers, `${action}.${paramName}`);
    if (!answer || answer.choice === NONE) {
      params[paramName] = { value: null, confidence: answer?.confidence ?? null };
      if ("required" in spec && spec.required) missing.push(paramName);
    } else {
      params[paramName] = { value: normalize(spec.type, answer.choice), confidence: answer.confidence };
    }
  }

  // The per-action types are precise, but we built `params` generically, so assert once here.
  // The result shape is exercised by classify.test.ts.
  return { action, confidence: picked.confidence, params, missing } as ActionCall;
}
