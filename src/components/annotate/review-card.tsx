"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";

import { ActionPanel } from "@/components/forms/action-panel";
import { ParamField } from "@/components/forms/param-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptCombined, combineFields, type CombinedField, type Extraction, type FieldSource } from "@/lib/annotate/combine";
import {
  isActionName,
  label,
  type Annotation,
  type ExpectedAction,
  type Prediction,
} from "@/lib/annotate/dataset";
import { verdict } from "@/lib/annotate/summary";
import { cn } from "@/lib/utils";
import { CATALOG, LOW_CONFIDENCE, type ParamSpec } from "@/lib/jev/catalog";
import type { ActionCall, ActionName, ParamValue } from "@/lib/jev/types";

const ACTIONS = Object.keys(CATALOG) as ActionName[];

/** The <input type> for each kind of parameter. */
const INPUT_TYPE = {
  name: "text",
  email: "email",
  phone: "tel",
  amount: "number",
  date: "date",
  account_number: "text",
} as const;

const VERDICT_BADGE = {
  correct: { text: "Correct", variant: "success" },
  wrong_action: { text: "Wrong action", variant: "destructive" },
  wrong_values: { text: "Wrong values", variant: "warning" },
} as const;

/** Rebuild the ActionCall the chat would have received, so the real form can be shown. */
function toActionCall(action: ActionName, prediction: Prediction, fields: CombinedField[]): ActionCall {
  const params = Object.fromEntries(
    fields.map((field) => [
      field.name,
      // LiquidFM's values carry no confidence; Jev's keep theirs, so "Please check" still shows.
      { value: field.value || null, confidence: field.source === "jev" ? field.jevConfidence : null } satisfies ParamValue,
    ]),
  );
  // The CSV is untyped text, so TypeScript can't prove the params line up with the action; the
  // loop above fills in exactly the catalog's params, which is what ActionPanel needs.
  return { action, confidence: prediction.actionConfidence ?? 0, params, missing: prediction.missing } as ActionCall;
}

/** How each model's work is marked: a badge on the row, and a tint behind it. */
const SOURCE_STYLE: Record<FieldSource, { badge: string; row: string; text: string }> = {
  jev: { badge: "border-sky-500/40 bg-sky-500/15", row: "bg-sky-500/10", text: "Jev" },
  liquid: { badge: "border-violet-500/40 bg-violet-500/15", row: "bg-violet-500/10", text: "LiquidFM" },
  blank: { badge: "border-warning/40 bg-warning/15", row: "bg-warning/10", text: "Blank" },
};

type Props = {
  prediction: Prediction;
  /** What the LiquidFM extractor read from this message (see lib/annotate/combine.ts). */
  extraction: Extraction;
  annotation: Annotation | undefined;
  position: number;
  total: number;
  onSave: (annotation: Annotation) => void;
};

/** One message: what Jev predicted, one-click "correct", and a form to write the right answer. */
export function ReviewCard({ prediction, extraction, annotation, position, total, onSave }: Props) {
  const predictedAction = prediction.predictedAction;
  // Jev's answer and LiquidFM's, merged field by field. Empty when Jev picked no action.
  const fields = isActionName(predictedAction) ? combineFields(predictedAction, prediction, extraction) : [];
  const accepted = acceptCombined(prediction, fields);
  // Until LiquidFM answers, the pre-filled values would change under the annotator's hands (and
  // "Correct" would save Jev-only values), so a message waits even if it was answered before.
  const waiting = extraction.status === "loading";
  const start = annotation ?? accepted;
  const [expectedAction, setExpectedAction] = useState<ExpectedAction>(start?.expectedAction ?? "none");
  const lowConfidence = prediction.actionConfidence !== null && prediction.actionConfidence < LOW_CONFIDENCE;
  const result = annotation ? verdict(prediction, annotation) : null;

  // Values to pre-fill for the chosen action: the saved answer if it is for that action, else the
  // combined Jev + LiquidFM values if Jev picked that action, else nothing.
  const defaults: Record<string, string> =
    start?.expectedAction === expectedAction ? start.expectedParams : {};

  function save(form: HTMLFormElement) {
    const data = new FormData(form);
    const expectedParams: Record<string, string> = {};
    if (isActionName(expectedAction)) {
      for (const name of Object.keys(CATALOG[expectedAction].params)) {
        const value = String(data.get(name) ?? "").trim();
        if (value) expectedParams[name] = value;
      }
    }
    onSave({ expectedAction, expectedParams, note: String(data.get("annotator_note") ?? "").trim() });
  }

  return (
    <article aria-labelledby="message-heading" className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <h2 id="message-heading" className="font-medium text-foreground">
            Message {position} of {total}
          </h2>
          {prediction.group && <Badge variant="outline">{prediction.group}</Badge>}
          {result && <Badge variant={VERDICT_BADGE[result].variant}>{VERDICT_BADGE[result].text}</Badge>}
        </div>
        <blockquote className="rounded-2xl rounded-bl-sm bg-primary px-4 py-3 text-base break-words text-primary-foreground">
          {prediction.message}
        </blockquote>
      </section>

      <section aria-labelledby="prediction-heading" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="prediction-heading" className="text-sm font-medium text-muted-foreground">
            Jev picked
          </h3>
          <span data-testid="predicted-action" className="font-mono text-sm font-semibold">
            {predictedAction}
          </span>
          {prediction.actionConfidence !== null && (
            <Badge variant={lowConfidence ? "warning" : "secondary"} className="tabular-nums">
              {Math.round(prediction.actionConfidence * 100)}% sure
            </Badge>
          )}
        </div>
        {prediction.note && <p className="text-sm text-destructive">{prediction.note}</p>}
        {fields.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground" data-testid="extractor-status">
              {extraction.status === "off" && "Values are Jev's."}
              {extraction.status === "loading" && "LiquidFM is reading the message…"}
              {extraction.status === "ready" && fields.every((f) => f.spec.type === "choice") && "Every field of this action is a choice, so all of it is Jev's."}
              {extraction.status === "ready" && fields.some((f) => f.spec.type !== "choice") && "Jev picked the action and the choices; LiquidFM read the typed-in values."}
              {extraction.status === "error" && `LiquidFM didn't answer (${extraction.message}), so these are Jev's values.`}
            </p>
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Parameter</th>
                  <th>Value</th>
                  <th>Filled by</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => {
                  const style = SOURCE_STYLE[field.source];
                  // Both models had a value and they disagree: show the one that lost.
                  const other =
                    field.source === "liquid" && field.jev && field.jev !== field.liquid ? `Jev said ${field.jev}` : null;
                  return (
                    <tr key={field.name} data-field={field.name} data-source={field.source} className={cn("border-t first:border-t-0", style.row)}>
                      <td className="px-2 py-1.5 text-muted-foreground">{label(field.name)}</td>
                      <td className="py-1.5 pr-3 font-medium break-all">
                        {field.value || <span className="font-normal text-muted-foreground">not stated</span>}
                        {other && <span className="ml-2 text-xs font-normal text-muted-foreground">{other}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {field.source === "jev" && field.jevConfidence !== null && (
                          <span className="mr-2 text-xs text-muted-foreground tabular-nums">{Math.round(field.jevConfidence * 100)}%</span>
                        )}
                        {/* Only say "Jev" or "LiquidFM" when the extractor is part of the picture. */}
                        {(extraction.status !== "off" || field.source === "blank") && (
                          <Badge className={cn("text-foreground", style.badge)}>{style.text}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No values extracted.</p>
        )}
        {prediction.missing.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Would ask the customer for: {prediction.missing.map(label).join(", ")}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button data-accept onClick={() => accepted && onSave(accepted)} disabled={!accepted || waiting}>
            <Check aria-hidden="true" />
            Correct
            <kbd className="ml-1 rounded border border-primary-foreground/30 px-1 font-mono text-xs">Y</kbd>
          </Button>
          <Button
            variant="outline"
            onClick={() => document.getElementById("expected-action")?.focus()}
          >
            <X aria-hidden="true" />
            Fix it
            <kbd className="ml-1 rounded border px-1 font-mono text-xs">N</kbd>
          </Button>
        </div>
      </section>

      <form
        aria-labelledby="expected-heading"
        className="flex flex-col gap-4 rounded-xl border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          save(event.currentTarget);
        }}
        // Text boxes submit on Enter by themselves; make the dropdowns do the same.
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLSelectElement) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
      >
        <fieldset disabled={waiting} className="contents">
        <div className="flex flex-col gap-1">
          <h3 id="expected-heading" className="font-semibold">
            Expected answer
          </h3>
          <p className="text-sm text-muted-foreground">
            What should Jev have picked? Starts as the answer above; change what&apos;s wrong and save.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="expected-action">Action</Label>
          <select
            id="expected-action"
            name="expected_action"
            value={expectedAction}
            onChange={(event) => setExpectedAction(event.target.value as ExpectedAction)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="none">none (no form should open)</option>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </div>
        {isActionName(expectedAction) && (
          // `key` remounts the fields when the action changes, so their pre-filled values reset.
          <div key={expectedAction} className="grid gap-4 sm:grid-cols-2">
            {Object.entries(CATALOG[expectedAction].params as Record<string, ParamSpec>).map(([name, spec]) => (
              <ParamField
                key={name}
                idPrefix="expected"
                name={name}
                label={label(name)}
                param={{ value: defaults[name] ?? null, confidence: null }}
                type={spec.type === "choice" ? undefined : INPUT_TYPE[spec.type]}
                options={spec.type === "choice" ? spec.options : undefined}
              />
            ))}
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="annotator-note">Note (optional)</Label>
          <Input id="annotator-note" name="annotator_note" defaultValue={annotation?.note ?? ""} autoComplete="off" />
        </div>
        <div>
          <Button type="submit" variant="secondary">
            Save and next
            <kbd className="ml-1 rounded border px-1 font-mono text-xs">Enter</kbd>
          </Button>
        </div>
        </fieldset>
      </form>

      {isActionName(predictedAction) && (
        <details className="group flex flex-col gap-3">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Show the form the customer would get
          </summary>
          <div className="pt-3">
            <ActionPanel call={toActionCall(predictedAction, prediction, fields)} />
          </div>
        </details>
      )}
    </article>
  );
}
