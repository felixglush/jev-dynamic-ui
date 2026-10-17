"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/** Year and month (0-11) of a YYYY-MM-DD value, or null when it isn't a real date (for example "tomorrow"). */
function parse(value: string) {
  const match = ISO.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const real = new Date(Date.UTC(year, month, day));
  return real.getUTCMonth() === month && real.getUTCDate() === day ? { year, month, day } : null;
}

type Props = {
  id: string;
  name: string;
  value: string;
  onValue: (value: string) => void;
  required?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

/** The month calendar. It only mounts once opened, so reading the current date never happens while the page is prerendered. */
function Calendar({ value, onPick, onClear }: { value: string; onPick: (iso: string) => void; onClear: () => void }) {
  const picked = parse(value);
  const [today] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  });
  // The month on show: the picked date's, else the current month. Arrows move it without changing the value.
  const [shown, setShown] = useState<{ year: number; month: number }>(picked ?? today);

  const first = new Date(Date.UTC(shown.year, shown.month, 1));
  const monthName = first.toLocaleDateString("en-CA", { month: "long", timeZone: "UTC" });
  const title = `${monthName} ${shown.year}`;
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const days = new Date(Date.UTC(shown.year, shown.month + 1, 0)).getUTCDate();
  const cells = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  function step(by: number) {
    const moved = new Date(Date.UTC(shown.year, shown.month + by, 1));
    setShown({ year: moved.getUTCFullYear(), month: moved.getUTCMonth() });
  }

  return (
    // Keep focus where it is while a calendar button is pressed, so the field's blur check doesn't close it first.
    <div role="group" aria-label={title} onMouseDown={(event) => event.preventDefault()} className="rounded-lg border bg-background p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <Button type="button" variant="ghost" size="icon" aria-label="Previous month" onClick={() => step(-1)}>
          <ChevronLeft />
        </Button>
        <span className="text-sm font-medium" aria-live="polite">
          {title}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label="Next month" onClick={() => step(1)}>
          <ChevronRight />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
        {WEEKDAYS.map((day, index) => (
          <span key={day} className={cn("py-1 text-xs font-medium", index >= 5 && "text-muted-foreground")}>
            {day}
          </span>
        ))}
        {cells.map((day, index) => {
          if (day === null) return <span key={`blank-${index}`} />;
          const weekend = (lead + day - 1) % 7 >= 5;
          const selected = picked?.year === shown.year && picked.month === shown.month && picked.day === day;
          const isToday = today.year === shown.year && today.month === shown.month && today.day === day;
          return (
            <button
              key={day}
              type="button"
              aria-label={`${monthName} ${day}, ${shown.year}`}
              aria-pressed={selected}
              onClick={() => onPick(iso(shown.year, shown.month, day))}
              className={cn(
                "mx-auto flex size-9 items-center justify-center rounded-full tabular-nums outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                weekend && "text-muted-foreground",
                isToday && !selected && "border border-primary",
                selected && "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
      {value && (
        <div className="mt-2 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear date
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A date as YYYY-MM-DD in a text box the customer can type in, with a month calendar that opens under
 * it (on focus, or from the calendar button). Picking a day fills the box and closes the calendar.
 */
export function DateField({ id, name, value, onValue, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={wrapper}
      className="grid gap-2"
      onBlur={(event) => {
        if (!wrapper.current?.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className="flex gap-2">
        <Input
          id={id}
          name={name}
          value={value}
          placeholder="YYYY-MM-DD"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => onValue(event.target.value)}
          className="tabular-nums"
          {...rest}
        />
        <Button type="button" variant="outline" size="icon" aria-label="Open calendar" aria-expanded={open} onClick={() => setOpen(!open)}>
          <CalendarDays />
        </Button>
      </div>
      {open && (
        <Calendar
          value={value}
          onPick={(picked) => {
            onValue(picked);
            setOpen(false);
          }}
          onClear={() => {
            onValue("");
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
