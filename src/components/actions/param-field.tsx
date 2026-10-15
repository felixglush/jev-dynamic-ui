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
};

/** One form field pre-filled from what Jev found, with a nudge when it is missing or uncertain. */
export function ParamField({ name, label, param, required, options, type = "text", placeholder }: Props) {
  const missing = required && param.value === null;
  const uncertain = param.value !== null && param.confidence !== null && param.confidence < LOW_CONFIDENCE;
  const id = `field-${name}`;

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {missing && <Badge variant="destructive">Needed</Badge>}
        {uncertain && <Badge variant="warning">Please check</Badge>}
      </div>
      {options ? (
        <select
          id={id}
          name={name}
          defaultValue={param.value ?? ""}
          aria-invalid={missing || undefined}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
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
          aria-invalid={missing || undefined}
        />
      )}
    </div>
  );
}
