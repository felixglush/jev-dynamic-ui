/**
 * The annotation dataset: Jev's predictions (one row per message, as `npm run predict` writes them)
 * plus the expected answers a person fills in. Reading and writing it as CSV lives here so the
 * server page, the import button and the export button all agree on the format.
 */
import { freeTextParams } from "@/lib/extract/prompt";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionName, ParamValue } from "@/lib/jev/types";
import { reviewOf, type Review, type ExampleRecord } from "@/lib/sft/examples";
import { parseCsv, toCsv } from "./csv";

export type Prediction = {
  id: string;
  group: string;
  message: string;
  /** An action name, "none" when Jev matched nothing, or "ERROR" when the call failed. */
  predictedAction: string;
  actionConfidence: number | null;
  params: Record<string, ParamValue>;
  missing: string[];
  /** The predict script's note, e.g. an error message. */
  note: string;
};

/** "none" means the message should not open any form. */
export type ExpectedAction = ActionName | "none";

export type Annotation = {
  expectedAction: ExpectedAction;
  /** Only the parameters that have a value. */
  expectedParams: Record<string, string>;
  note: string;
};

/** Annotations are keyed by prediction id. */
export type Annotations = Record<string, Annotation>;

export type Dataset = { predictions: Prediction[]; annotations: Annotations };

// The `value is ActionName` return type tells TypeScript what a true result means, so code after
// an `if (isActionName(x))` check can use x as an ActionName.
export { freeTextParams };

export function isActionName(value: string): value is ActionName {
  return Object.hasOwn(CATALOG, value);
}

export function isExpectedAction(value: string): value is ExpectedAction {
  return value === "none" || isActionName(value);
}

/** "send_etransfer" → "send etransfer", for display. */
export const label = (name: string) => name.replaceAll("_", " ");

/** "recipient=Sam (1.00); amount=50.00 (0.98)" → { recipient: { value: "Sam", confidence: 1 }, ... } */
export function parseParams(text: string): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const part of text.split(";")) {
    const match = /^\s*(\w+)=(.*?)(?:\s\((\d*\.?\d+)\))?\s*$/.exec(part);
    const [, name, value = "", confidence] = match ?? [];
    if (!name) continue;
    params[name] = { value, confidence: confidence === undefined ? null : Number(confidence) };
  }
  return params;
}

/** "recipient=Sam; amount=50.00" ↔ { recipient: "Sam", amount: "50.00" }, without confidences. */
// Values are free text, so a ";" inside one is written as %3B (and "%" as %25) to keep it from
// reading as the separator between parameters.
const encodeValue = (value: string) => value.replaceAll("%", "%25").replaceAll(";", "%3B");
const decodeValue = (value: string) => value.replace(/%(25|3B)/gi, (code) => (code === "%25" ? "%" : ";"));

function parseExpectedParams(text: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parseParams(text)).flatMap(([name, p]) => (p.value ? [[name, decodeValue(p.value)]] : [])),
  );
}

function formatExpectedParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([name, value]) => `${name}=${encodeValue(value)}`)
    .join("; ");
}

/**
 * Read a fine-tuning file (JSONL, one record per line, as `npm run sft:build` and `npm run
 * extract:eval -- x x.jsonl` write them). Each record becomes a row to review: the assistant's JSON
 * answer is the "output" (a training label, or what the model said), and blank fields stay blank.
 */
export function parseSftJsonl(text: string): Dataset {
  const predictions: Prediction[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of text.replace(/^\uFEFF/, "").split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const where = `Line ${index + 1}`;
    let record: { messages?: { role?: string; content?: string }[]; meta?: { id?: string; action?: string; vague?: boolean } };
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`${where}: not valid JSON.`);
    }
    const message = record.messages?.find((m) => m.role === "user")?.content;
    const answerText = record.messages?.find((m) => m.role === "assistant")?.content;
    const action = record.meta?.action ?? "";
    if (typeof message !== "string" || typeof answerText !== "string") throw new Error(`${where}: needs user and assistant messages.`);
    if (!isActionName(action)) throw new Error(`${where}: meta.action "${action}" isn't an action.`);
    let answer: Record<string, unknown>;
    try {
      answer = JSON.parse(answerText);
    } catch {
      throw new Error(`${where}: the assistant message isn't JSON.`);
    }
    const id = String(record.meta?.id ?? index + 1);
    if (seen.has(id)) throw new Error(`${where}: id ${id} appears more than once.`);
    seen.add(id);

    const params: Record<string, ParamValue> = {};
    const missing: string[] = [];
    for (const [name, spec] of freeTextParams(action)) {
      const value = answer[name];
      const stated = typeof value === "string" ? value.trim() : typeof value === "number" && value !== 0 ? String(value) : "";
      if (stated) params[name] = { value: stated, confidence: null };
      else if (spec.required) missing.push(name);
    }
    predictions.push({ id, group: action + (record.meta?.vague ? " (vague)" : ""), message, predictedAction: action, actionConfidence: null, params, missing, note: "" });
  }
  if (predictions.length === 0) throw new Error("The file has no records.");
  return { predictions, annotations: {} };
}

/**
 * The examples file as rows to review. The "output" shown is what the generator wrote (its first
 * answer, even after a reviewer corrected it), and rows already approved or rejected come back as
 * annotations, so the page picks up where the file says review stands.
 */
export function datasetFromReviews(records: ExampleRecord[]): Dataset {
  const asGenerated = records.map(({ meta: { original, ...meta }, messages }) =>
    JSON.stringify({
      messages: [messages[0], messages[1], { role: "assistant", content: original?.answer ?? messages[2].content }],
      meta: { ...meta, action: original?.action ?? meta.action },
    }),
  );
  const { predictions } = parseSftJsonl(asGenerated.join("\n"));
  const annotations: Annotations = {};
  for (const record of records) {
    const review: Review | null = reviewOf(record);
    if (review) annotations[record.meta.id] = { expectedAction: review.expectedAction as ExpectedAction, expectedParams: review.expectedParams, note: review.note ?? "" };
  }
  return { predictions, annotations };
}

/** A predictions CSV or an SFT JSONL file: JSONL lines start with "{". */
export function parseAnyDataset(text: string): Dataset {
  return text.replace(/^\uFEFF/, "").trimStart().startsWith("{") ? parseSftJsonl(text) : parseDataset(text);
}

/**
 * The reviewed answers as batch lines (the format `npm run sft:add` reads): `message => field=value`,
 * grouped under `# <action>`. Rows marked "none", or not reviewed yet, are left out.
 */
export function serializeLabels({ predictions, annotations }: Dataset): string {
  const byAction = new Map<string, string[]>();
  for (const p of predictions) {
    const a = annotations[p.id];
    if (!a || !isActionName(a.expectedAction)) continue;
    const clean = (text: string) => text.replaceAll(/\s*;\s*/g, " ").replaceAll("=>", "->").replaceAll(/\s+/g, " ").trim();
    const labels = Object.entries(a.expectedParams)
      .filter(([name]) => freeTextParams(a.expectedAction as ActionName).some(([free]) => free === name))
      .map(([name, value]) => `${name}=${clean(value)}`)
      .join("; ");
    const lines = byAction.get(a.expectedAction) ?? [];
    lines.push(labels ? `${clean(p.message)} => ${labels}` : clean(p.message));
    byAction.set(a.expectedAction, lines);
  }
  return [...byAction].map(([action, lines]) => `# ${action}\n${lines.join("\n")}`).join("\n") + "\n";
}

const REQUIRED_COLUMNS = ["id", "message", "predicted_action"];

/**
 * Read a predictions CSV. If it was exported from the annotator (or filled in by hand), the
 * expected_action / expected_params / note columns come back as annotations.
 * Throws an Error with a readable message when the file isn't a predictions CSV.
 */
export function parseDataset(text: string): Dataset {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, "")); // a BOM if Excel saved it
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header?.includes(c));
  if (!header || missingColumns.length > 0) {
    throw new Error(`Not a predictions CSV: missing column(s) ${missingColumns.join(", ")}.`);
  }
  const column = (row: string[], name: string) => {
    const index = header.indexOf(name);
    return index === -1 ? "" : (row[index] ?? "").trim();
  };

  const predictions: Prediction[] = [];
  const annotations: Annotations = {};
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const line = index + 2; // 1-based, after the header, as a spreadsheet numbers it
    const id = column(row, "id");
    if (!id) continue;
    // Fail loudly rather than drop data: annotations are keyed by id.
    if (seen.has(id)) throw new Error(`Line ${line}: id ${id} appears more than once.`);
    seen.add(id);

    const confidence = column(row, "action_confidence");
    predictions.push({
      id,
      group: column(row, "group"),
      message: column(row, "message"),
      predictedAction: column(row, "predicted_action"),
      actionConfidence: confidence === "" ? null : Number(confidence),
      params: parseParams(column(row, "params")),
      missing: column(row, "missing_required").split(";").map((s) => s.trim()).filter(Boolean),
      note: column(row, "note"),
    });

    const expected = column(row, "expected_action");
    if (expected) {
      if (!isExpectedAction(expected)) {
        throw new Error(`Line ${line}: "${expected}" isn't an action. Use none or one of: ${Object.keys(CATALOG).join(", ")}.`);
      }
      annotations[id] = {
        expectedAction: expected,
        expectedParams: parseExpectedParams(column(row, "expected_params")),
        note: column(row, "annotator_note"),
      };
    }
  }
  if (predictions.length === 0) throw new Error("The CSV has a header but no predictions.");
  return { predictions, annotations };
}

const EXPORT_HEADER = [
  "id",
  "group",
  "message",
  "predicted_action",
  "action_confidence",
  "params",
  "missing_required",
  "expected_action",
  "expected_params",
  "note",
  "annotator_note",
];

/** The predictions CSV with the expected columns filled in. parseDataset reads it back. */
export function serializeDataset({ predictions, annotations }: Dataset): string {
  const rows = predictions.map((p) => {
    const a = annotations[p.id];
    const params = Object.entries(p.params)
      .map(([name, v]) => `${name}=${v.value}${v.confidence === null ? "" : ` (${v.confidence.toFixed(2)})`}`)
      .join("; ");
    return [
      p.id,
      p.group,
      p.message,
      p.predictedAction,
      p.actionConfidence === null ? "" : p.actionConfidence.toFixed(3),
      params,
      p.missing.join("; "),
      a?.expectedAction ?? "",
      a ? formatExpectedParams(a.expectedParams) : "",
      p.note,
      a?.note ?? "",
    ];
  });
  return toCsv([EXPORT_HEADER, ...rows]);
}

/** The annotation that says "Jev got it exactly right". */
export function acceptPrediction(prediction: Prediction): Annotation | null {
  if (!isExpectedAction(prediction.predictedAction)) return null; // e.g. "ERROR"
  const expectedParams: Record<string, string> = {};
  for (const [name, p] of Object.entries(prediction.params)) {
    if (p.value) expectedParams[name] = p.value;
  }
  return { expectedAction: prediction.predictedAction, expectedParams, note: "" };
}

const MAX_PARAM_LENGTH = 200;
const MAX_NOTE_LENGTH = 500;

/**
 * Check annotations that arrived from the browser before they are written to disk. Server Actions
 * are public endpoints, so this keeps only known message ids, known actions, the catalog's own
 * parameter names and bounded text. Throws an Error for anything else.
 */
export function sanitizeAnnotations(predictions: Prediction[], raw: unknown): Annotations {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Annotations must be an object.");
  const known = new Set(predictions.map((p) => p.id));
  const clean: Annotations = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!known.has(id)) throw new Error(`Unknown message id ${id}.`);
    const a = value as Partial<Record<keyof Annotation, unknown>> | null;
    const action = typeof a?.expectedAction === "string" ? a.expectedAction : "";
    if (!isExpectedAction(action)) throw new Error(`Message ${id}: "${action}" isn't an action.`);
    const expectedParams: Record<string, string> = {};
    if (isActionName(action) && typeof a?.expectedParams === "object" && a.expectedParams !== null) {
      const given = a.expectedParams as Record<string, unknown>;
      for (const name of Object.keys(CATALOG[action].params)) {
        const text = typeof given[name] === "string" ? given[name].trim() : "";
        if (text) expectedParams[name] = text.slice(0, MAX_PARAM_LENGTH);
      }
    }
    const note = typeof a?.note === "string" ? a.note.trim().slice(0, MAX_NOTE_LENGTH) : "";
    clean[id] = { expectedAction: action, expectedParams, note };
  }
  return clean;
}

/**
 * The annotations in a saved file that still belong to these predictions. A row counts only if its
 * message text is unchanged, so re-running `npm run predict` with different messages can't attach
 * old answers to new messages that happen to reuse an id.
 */
export function annotationsFor(predictions: Prediction[], saved: Dataset): Annotations {
  const messages = new Map(predictions.map((p) => [p.id, p.message]));
  const sameMessage = new Set(saved.predictions.filter((p) => messages.get(p.id) === p.message).map((p) => p.id));
  return Object.fromEntries(Object.entries(saved.annotations).filter(([id]) => sameMessage.has(id)));
}
