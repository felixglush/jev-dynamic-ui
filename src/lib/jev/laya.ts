/**
 * Laya as the classifier (set CLASSIFIER=laya). Same questions as Jev, answered by the local Laya server
 * (scripts/laya/server.py) instead of the TypeSafe API. `LAYA_URL` overrides the default address.
 */
import "server-only";

import { buildQuestionSpecs, type ChoiceAnswers } from "./classify";

const laya = () => process.env.LAYA_URL ?? "http://127.0.0.1:8765";

/** Laya reads the message as plain text, so the questions refer to "the message", not to a `query` field. */
const forLaya = (text: string) => text.replaceAll("`query`", "the message");

type LayaAnswers = Record<string, { type: string; choice: string; confidence: number }>;

async function predict(text: string, keys: string[]): Promise<LayaAnswers> {
  const specs = buildQuestionSpecs();
  const questions = Object.fromEntries(
    keys.map((key) => {
      const spec = specs[key]!;
      return [
        key,
        {
          type: "choice",
          instructions: forLaya(spec.question),
          criteria: Object.fromEntries(
            Object.entries(spec.options)
              .filter(([name]) => !(process.env.LAYA_NO_NONE && name === "none"))
              .map(([name, desc]) => [name, forLaya(desc)]),
          ),
        },
      ];
    }),
  );
  let response: Response;
  try {
    response = await fetch(`${laya()}/predict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, questions }),
    });
  } catch (error) {
    throw new Error(`Laya server not reachable at ${laya()} (start scripts/laya/server.py)`, { cause: error });
  }
  if (!response.ok) throw new Error(`Laya server returned ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { answers: LayaAnswers }).answers;
}

/**
 * Laya's time grows with the number of questions (about 0.2 s each on CPU), unlike Jev's single request, so
 * the speculative "ask every action's choices" trick is too slow here. Ask the action first, then only the
 * choice questions of the action it picked.
 */
export async function askLaya(query: string): Promise<ChoiceAnswers> {
  const out: ChoiceAnswers = {};
  const keep = (answers: LayaAnswers) => {
    for (const [key, answer] of Object.entries(answers)) {
      if (answer.type === "choice") out[key] = { choice: answer.choice, confidence: answer.confidence };
    }
  };
  keep(await predict(query, ["__action__"]));
  const action = out.__action__?.choice;
  if (!action || action === "none") return out;
  const prefix = `${action}.`;
  const paramKeys = Object.keys(buildQuestionSpecs()).filter((key) => key.startsWith(prefix));
  if (paramKeys.length) keep(await predict(query, paramKeys));
  return out;
}
