/**
 * Merges what Jev and the LiquidFM extractor each found for a message into one list of fields,
 * remembering which model filled each one. Plain functions, so the review card and tests share them.
 *
 * The split of work: Jev picks the action and every choice field (which account, which card), and
 * LiquidFM reads the free-text fields (names, emails, amounts, dates). Where LiquidFM leaves a
 * field blank, Jev's value for it is used if Jev had one.
 */
import { CATALOG, type ParamSpec } from "@/lib/jev/catalog";
import type { ActionName } from "@/lib/jev/types";
import type { Annotation, Prediction } from "./dataset";

/** What the extractor returned for one message. */
export type Extraction =
  | { status: "off" } // no extractor wired up (the static preview): Jev's values are shown as they are
  | { status: "loading" }
  | { status: "ready"; fields: Record<string, string | number | null> }
  | { status: "error"; message: string };

/** Who filled a field: Jev, LiquidFM, or nobody (the customer will have to type it). */
export type FieldSource = "jev" | "liquid" | "blank";

export type CombinedField = {
  name: string;
  spec: ParamSpec;
  value: string;
  source: FieldSource;
  /** Jev's own value, kept so the card can show where the two models disagree. */
  jev: string;
  /** Jev's confidence in its value, when it gave one. */
  jevConfidence: number | null;
  /** LiquidFM's own value ("" when it left the field blank or didn't run). */
  liquid: string;
};

/** The extractor answers amounts as numbers; show them the way Jev's are: 50 → "50.00". */
function formatLiquid(spec: ParamSpec, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (spec.type === "amount") {
    const number = Number(String(value).replaceAll(/[$,\s]/g, ""));
    return Number.isFinite(number) && number > 0 ? number.toFixed(2) : "";
  }
  // The extractor copies dates as written ("tomorrow"), which a date input can't show and which
  // wouldn't match Jev's ISO dates when scoring. Only a real date is used; otherwise Jev's stays.
  if (spec.type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()) ? String(value).trim() : "";
  return String(value).trim();
}

export function combineFields(action: ActionName, prediction: Prediction, extraction: Extraction): CombinedField[] {
  const specs: Record<string, ParamSpec> = CATALOG[action].params;
  return Object.entries(specs).map(([name, spec]) => {
    const jevParam = prediction.params[name];
    const jev = jevParam?.value ?? "";
    const liquid = spec.type === "choice" || extraction.status !== "ready" ? "" : formatLiquid(spec, extraction.fields[name]);
    const value = liquid || jev;
    const source: FieldSource = liquid ? "liquid" : jev ? "jev" : "blank";
    return { name, spec, value, source, jev, jevConfidence: jevParam?.confidence ?? null, liquid };
  });
}

/** The annotation that says "the fields on screen are exactly right". */
export function acceptCombined(prediction: Prediction, fields: CombinedField[]): Annotation | null {
  const action = prediction.predictedAction;
  if (action !== "none" && !Object.hasOwn(CATALOG, action)) return null; // e.g. "ERROR"
  const expectedParams: Record<string, string> = {};
  for (const field of fields) if (field.value) expectedParams[field.name] = field.value;
  return { expectedAction: action as Annotation["expectedAction"], expectedParams, note: "" };
}
