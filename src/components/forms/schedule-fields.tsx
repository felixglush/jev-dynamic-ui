import { ParamField } from "./param-field";
import { FREQUENCY_OPTIONS } from "@/lib/jev/catalog";
import type { ParamValue } from "@/lib/jev/types";

/** The "when" and "how often" fields shared by every payment that can be scheduled. */
export function ScheduleFields({ date, frequency }: { date: ParamValue; frequency: ParamValue }) {
  return (
    <>
      <ParamField name="date" label="Date (optional)" param={date} type="date" />
      <ParamField name="frequency" label="Repeats" param={frequency} options={FREQUENCY_OPTIONS} emptyLabel="Does not repeat" />
    </>
  );
}
