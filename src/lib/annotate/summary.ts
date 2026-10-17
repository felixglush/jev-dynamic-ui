/**
 * Scores Jev's predictions against the annotations: is the action right, and are the extracted
 * values right? Pure functions over the dataset, so the summary screen and tests share them.
 */
import { CATALOG, LOW_CONFIDENCE } from "@/lib/jev/catalog";
import type { ParamSpec } from "@/lib/jev/catalog";
import type { ActionName } from "@/lib/jev/types";
import { isActionName, type Annotation, type Dataset, type Prediction } from "./dataset";

/** Compare values the way a person would: 50 equals 50.00, 416-555-0199 equals 4165550199. */
function normalize(value: string | null | undefined, type: ParamSpec["type"]): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (type === "amount") {
    const number = Number(text.replaceAll(/[$,\s]/g, ""));
    return Number.isFinite(number) ? number.toFixed(2) : text;
  }
  if (type === "phone") return text.replaceAll(/\D/g, "");
  return text.toLowerCase();
}

/** The parameters of an action, each with whether Jev's value matches the expected one. */
export function compareParams(action: ActionName, prediction: Prediction, annotation: Annotation) {
  const specs: Record<string, ParamSpec> = CATALOG[action].params;
  return Object.entries(specs).map(([name, spec]) => {
    const predicted = prediction.params[name]?.value;
    const expected = annotation.expectedParams[name];
    const correct = normalize(predicted, spec.type) === normalize(expected, spec.type);
    // Same value, written differently ("$50" vs "50.00"): right, but the reviewer still edited it.
    const reformatted = correct && (predicted ?? "").trim() !== (expected ?? "").trim();
    return { name, correct, reformatted };
  });
}

/** "fixed": every value is right, but the reviewer rewrote one (say, "$50" to "50.00") or left a note. */
export type Verdict = "correct" | "fixed" | "wrong_action" | "wrong_values";

export function verdict(prediction: Prediction, annotation: Annotation): Verdict {
  if (prediction.predictedAction !== annotation.expectedAction) return "wrong_action";
  if (!isActionName(annotation.expectedAction)) return annotation.note.trim() ? "fixed" : "correct"; // "none" has no values
  const params = compareParams(annotation.expectedAction, prediction, annotation);
  if (!params.every((p) => p.correct)) return "wrong_values";
  return params.some((p) => p.reformatted) || annotation.note.trim() ? "fixed" : "correct";
}

type Tally = { total: number; correct: number };

export type Summary = {
  total: number;
  reviewed: number;
  /** Rows whose action matches. */
  action: Tally;
  /** Rows whose action and every value match. */
  exact: Tally;
  /** Individual values, counted only on rows whose action matches. */
  values: Tally;
  /** Action accuracy grouped by the expected action. */
  byExpectedAction: Array<{ action: string } & Tally>;
  /** Action accuracy split at the low-confidence threshold: is Jev's confidence telling the truth? */
  byConfidence: Array<{ label: string } & Tally>;
  /** Rows counted as right where the reviewer only reformatted a value or added a note. */
  fixed: number;
  mistakes: Array<{ prediction: Prediction; annotation: Annotation; verdict: Exclude<Verdict, "correct" | "fixed"> }>;
};

export function summarize({ predictions, annotations }: Dataset): Summary {
  const summary: Summary = {
    total: predictions.length,
    reviewed: 0,
    action: { total: 0, correct: 0 },
    exact: { total: 0, correct: 0 },
    values: { total: 0, correct: 0 },
    byExpectedAction: [],
    byConfidence: [],
    fixed: 0,
    mistakes: [],
  };
  const byAction = new Map<string, Tally>();
  const high = { label: `Confidence ≥ ${LOW_CONFIDENCE}`, total: 0, correct: 0 };
  const low = { label: `Confidence < ${LOW_CONFIDENCE}`, total: 0, correct: 0 };

  for (const prediction of predictions) {
    const annotation = annotations[prediction.id];
    if (!annotation) continue;
    summary.reviewed++;

    const actionCorrect = prediction.predictedAction === annotation.expectedAction;
    const result = verdict(prediction, annotation);
    summary.action.total++;
    summary.exact.total++;
    if (actionCorrect) summary.action.correct++;
    if (result === "correct" || result === "fixed") summary.exact.correct++;
    if (result === "fixed") summary.fixed++;
    if (result !== "correct" && result !== "fixed") summary.mistakes.push({ prediction, annotation, verdict: result });

    if (actionCorrect && isActionName(annotation.expectedAction)) {
      for (const param of compareParams(annotation.expectedAction, prediction, annotation)) {
        summary.values.total++;
        if (param.correct) summary.values.correct++;
      }
    }

    const tally = byAction.get(annotation.expectedAction) ?? { total: 0, correct: 0 };
    tally.total++;
    if (actionCorrect) tally.correct++;
    byAction.set(annotation.expectedAction, tally);

    const bucket = (prediction.actionConfidence ?? 0) >= LOW_CONFIDENCE ? high : low;
    bucket.total++;
    if (actionCorrect) bucket.correct++;
  }

  summary.byExpectedAction = [...byAction].map(([action, tally]) => ({ action, ...tally }));
  summary.byConfidence = [high, low];
  return summary;
}

/** "12 of 15 (80%)", or "–" when there is nothing to count yet. */
export function formatTally({ total, correct }: Tally): string {
  if (total === 0) return "–";
  return `${correct} of ${total} (${Math.round((correct / total) * 100)}%)`;
}
