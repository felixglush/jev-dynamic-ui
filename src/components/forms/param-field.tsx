"use client";

import { useEffect, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "./date-field";
import { LOW_CONFIDENCE } from "@/lib/jev/catalog";
import type { ParamValue } from "@/lib/jev/types";

type Props = {
  name: string;
  label: string;
  param: ParamValue;
  required?: boolean;
  /** Passing options renders a dropdown instead of a text box. */
  options?: Record<string, string>;
  /** What the dropdown's empty choice says; "Choose…" unless leaving it empty has its own meaning. */
  emptyLabel?: string;
  /** Called with the field's value when it changes, whether the customer or Jev changed it. */
  onSelect?: (value: string) => void;
  /** Same as onSelect; reads better on text fields whose neighbours' "required" depends on them. */
  onValue?: (value: string) => void;
  type?: React.ComponentProps<"input">["type"];
  placeholder?: string;
  /** Keeps ids unique when two forms with the same fields share a page. */
  idPrefix?: string;
};

/** One form field pre-filled from what Jev found, with a nudge when it is missing or uncertain. */
export function ParamField({ name, label, param, required, options, emptyLabel = "Choose…", onSelect, onValue, type = "text", placeholder, idPrefix = "field" }: Props) {
  // The chat keeps every earlier form on screen, so two forms can both have an "amount" field.
  // useId gives each field instance its own id; deriving it from `name` alone would clash.
  const id = `${idPrefix}-${useId()}-${name}`;
  const statusId = `${id}-status`;

  // Mirror what is typed so the badges react to the customer's edits, not only to Jev's guess.
  const [current, setCurrent] = useState(param.value ?? "");
  const [edited, setEdited] = useState(false);
  // Jev can answer again while the customer keeps typing in the chat, so a new guess replaces the
  // old one, unless the customer has already changed this field by hand. Setting state during
  // render like this is React's way to "reset state when a prop changes" without an extra pass.
  const [seen, setSeen] = useState(param.value);
  if (param.value !== seen) {
    setSeen(param.value);
    if (!edited) setCurrent(param.value ?? "");
  }
  // Tell the form what the field holds now, whether Jev or the customer last changed it.
  useEffect(() => {
    onSelect?.(current);
    onValue?.(current);
  }, [current, onSelect, onValue]);
  const missing = required && current.trim() === "";
  // Once the customer has touched a value they have checked it themselves.
  const uncertain = !edited && param.value !== null && param.confidence !== null && param.confidence < LOW_CONFIDENCE;
  // Read out "Needed" or "Please check" together with the field, not just show it.
  const describedBy = missing || uncertain ? statusId : undefined;

  function track(value: string) {
    setCurrent(value);
    setEdited(true);
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {missing && (
          <Badge id={statusId} variant="destructive">
            Needed
          </Badge>
        )}
        {!missing && uncertain && (
          <Badge id={statusId} variant="warning">
            Please check
          </Badge>
        )}
      </div>
      {options ? (
        <select
          id={id}
          name={name}
          value={current}
          required={required}
          aria-invalid={missing || undefined}
          aria-describedby={describedBy}
          onChange={(event) => track(event.target.value)}
          // Explicit colors: native dropdowns ignore the page theme in some browsers' dark mode.
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
        >
          <option value="">{emptyLabel}</option>
          {Object.keys(options).map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      ) : type === "date" ? (
        <DateField
          id={id}
          name={name}
          value={current}
          onValue={track}
          required={required}
          aria-invalid={missing || undefined}
          aria-describedby={describedBy}
        />
      ) : (
        <Input
          id={id}
          name={name}
          type={type}
          value={current}
          placeholder={placeholder}
          required={required}
          aria-invalid={missing || undefined}
          aria-describedby={describedBy}
          onChange={(event) => track(event.target.value)}
          // These are other people's details, so don't let the browser autofill the user's own.
          autoComplete="off"
          spellCheck={type === "email" || type === "tel" ? false : undefined}
          inputMode={type === "number" ? "decimal" : undefined}
          step={type === "number" ? "0.01" : undefined}
          min={type === "number" ? 0 : undefined}
          className={type === "number" ? "tabular-nums" : undefined}
        />
      )}
    </div>
  );
}
