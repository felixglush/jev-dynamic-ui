import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOW_CONFIDENCE } from "@/lib/jev/catalog";
import type { ParamValue } from "@/lib/jev/types";

type Props = {
  name: string;
  label: string;
  param: ParamValue;
  required?: boolean;
  /** Passing options renders a dropdown instead of a text box. */
  options?: Record<string, string>;
  type?: React.ComponentProps<"input">["type"];
  placeholder?: string;
  /** Keeps ids unique when two forms with the same fields share a page. */
  idPrefix?: string;
};

/** One form field pre-filled from what Jev found, with a nudge when it is missing or uncertain. */
export function ParamField({
  name,
  label,
  param,
  required,
  options,
  type = "text",
  placeholder,
  idPrefix = "field",
}: Props) {
  const missing = required && param.value === null;
  const uncertain = param.value !== null && param.confidence !== null && param.confidence < LOW_CONFIDENCE;
  const id = `${idPrefix}-${name}`;
  const statusId = `${id}-status`;
  // Read out "Needed" or "Please check" together with the field, not just show it.
  const describedBy = missing || uncertain ? statusId : undefined;

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {missing && (
          <Badge id={statusId} variant="destructive">
            Needed
          </Badge>
        )}
        {uncertain && (
          <Badge id={statusId} variant="warning">
            Please check
          </Badge>
        )}
      </div>
      {options ? (
        <select
          id={id}
          name={name}
          defaultValue={param.value ?? ""}
          required={required}
          aria-invalid={missing || undefined}
          aria-describedby={describedBy}
          // Explicit colors: native dropdowns ignore the page theme in some browsers' dark mode.
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
        >
          <option value="">Choose…</option>
          {Object.keys(options).map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          name={name}
          type={type}
          defaultValue={param.value ?? ""}
          placeholder={placeholder}
          required={required}
          aria-invalid={missing || undefined}
          aria-describedby={describedBy}
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
