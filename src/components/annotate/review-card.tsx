"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";

import { ActionPanel } from "@/components/forms/action-panel";
import { ParamField } from "@/components/forms/param-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  acceptPrediction,
  freeTextParams,
  isActionName,
  label,
  type Annotation,
  type ExpectedAction,
  type Prediction,
} from "@/lib/annotate/dataset";
import { verdict } from "@/lib/annotate/summary";
import { CATALOG, LOW_CONFIDENCE, type ParamSpec } from "@/lib/jev/catalog";
import type { ActionCall, ActionName, ParamValue } from "@/lib/jev/types";

const ACTIONS = Object.keys(CATALOG) as ActionName[];

/** The <input type> for each kind of parameter. Dates are plain text: the fine-tuning data keeps them as written ("tomorrow", "the 1st"). */
const INPUT_TYPE = {
  name: "text",
  email: "email",
  phone: "tel",
  amount: "number",
  date: "text",
  account_number: "text",
} as const;

const VERDICT_BADGE = {
  correct: { text: "Correct", variant: "success" },
  reformatted: { text: "Fixed formatting", variant: "warning" },
  wrong_action: { text: "Wrong action", variant: "destructive" },
  wrong_values: { text: "Wrong values", variant: "warning" },
} as const;

/** Rebuild the ActionCall the chat would have received, so the real form can be shown. */
function toActionCall(action: ActionName, prediction: Prediction): ActionCall {
  const params = Object.fromEntries(
    Object.keys(CATALOG[action].params).map((name) => [
      name,
      prediction.params[name] ?? ({ value: null, confidence: null } satisfies ParamValue),
    ]),
  );
  // The CSV is untyped text, so TypeScript can't prove the params line up with the action; the
  // loop above fills in exactly the catalog's params, which is what ActionPanel needs.
  return { action, confidence: prediction.actionConfidence ?? 0, params, missing: prediction.missing } as ActionCall;
}

/** "full" is the whole picture; "fields" is only what the extractor model fills in. */
export type ReviewMode = "full" | "fields";

type Props = {
  mode: ReviewMode;
  prediction: Prediction;
  annotation: Annotation | undefined;
  position: number;
  total: number;
  onSave: (annotation: Annotation) => void;
};

/** One message: what Jev predicted, one-click "correct", and a form to write the right answer. */
export function ReviewCard({ mode, prediction, annotation, position, total, onSave }: Props) {
  const accepted = acceptPrediction(prediction);
  const start = annotation ?? accepted;
  const [expectedAction, setExpectedAction] = useState<ExpectedAction>(start?.expectedAction ?? "none");
  const lowConfidence = prediction.actionConfidence !== null && prediction.actionConfidence < LOW_CONFIDENCE;
  const result = annotation ? verdict(prediction, annotation) : null;
  const predictedAction = prediction.predictedAction;
  const fieldsOnly = mode === "fields";
  // Fields view: one row per field the extractor model fills in, blanks included, so a missing value is visible.
  const outputRows: [string, ParamValue | undefined][] =
    fieldsOnly && isActionName(predictedAction)
      ? freeTextParams(predictedAction).map(([name]) => [name, prediction.params[name]])
      : Object.entries(prediction.params);

  // Values to pre-fill for the chosen action: the saved answer if it is for that action, else
  // Jev's values if Jev picked that action, else nothing.
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
            {fieldsOnly ? "Extractor output" : "Jev predicted"}
          </h3>
          <span data-testid="predicted-action" className="font-mono text-sm font-semibold">
            {predictedAction}
          </span>
          {!fieldsOnly && prediction.actionConfidence !== null && (
            <Badge variant={lowConfidence ? "warning" : "secondary"} className="tabular-nums">
              {Math.round(prediction.actionConfidence * 100)}% sure
            </Badge>
          )}
        </div>
        {prediction.note && <p className="text-sm text-destructive">{prediction.note}</p>}
        {outputRows.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>Parameter</th>
                <th>Value</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {outputRows.map(([name, p]) => (
                <tr key={name} className="border-t first:border-t-0">
                  <td className="py-1.5 pr-3 text-muted-foreground">{label(name)}</td>
                  <td className="py-1.5 pr-3 font-medium break-all">
                    {p?.value || (fieldsOnly && <span className="rounded bg-warning/15 px-1.5 text-muted-foreground">blank</span>)}
                  </td>
                  <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                    {p?.confidence == null ? "" : `${Math.round(p.confidence * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground">No values extracted.</p>
        )}
        {!fieldsOnly && prediction.missing.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Would ask the customer for: {prediction.missing.map(label).join(", ")}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button data-accept onClick={() => accepted && onSave(accepted)} disabled={!accepted}>
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
        <div className="flex flex-col gap-1">
          <h3 id="expected-heading" className="font-semibold">
            Expected answer
          </h3>
          <p className="text-sm text-muted-foreground">
            What should Jev have picked? Starts as Jev&apos;s answer; change what&apos;s wrong and save.
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
            {Object.entries(CATALOG[expectedAction].params as Record<string, ParamSpec>)
              .filter(([, spec]) => !fieldsOnly || spec.type !== "choice")
              .map(([name, spec]) => (
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
      </form>

      {!fieldsOnly && isActionName(predictedAction) && (
        <details className="group flex flex-col gap-3">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Show the form the customer would get
          </summary>
          <div className="pt-3">
            <ActionPanel call={toActionCall(predictedAction, prediction)} />
          </div>
        </details>
      )}
    </article>
  );
}
