/**
 * The annotation dataset: Jev's predictions (one row per message, as `npm run predict` writes them)
 * plus the expected answers a person fills in. Reading and writing it as CSV lives here so the
 * server page, the import button and the export button all agree on the format.
 */
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionName, ParamValue } from "@/lib/jev/types";
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
