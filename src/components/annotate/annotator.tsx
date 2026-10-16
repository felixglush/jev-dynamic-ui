"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { parseDataset, serializeDataset, type Annotation, type Annotations, type Dataset } from "@/lib/annotate/dataset";
import { saveFile } from "@/lib/annotate/save-file";
import { summarize, verdict } from "@/lib/annotate/summary";
import { cn } from "@/lib/utils";
import { ReviewCard } from "./review-card";
import { SummaryView } from "./summary-view";

type Props = { initial: Dataset; initialSource: string };

/** A short fingerprint of the messages, so saved progress is only restored for the same file. */
function storageKey(dataset: Dataset): string {
  let hash = 5381;
  for (const char of dataset.predictions.map((p) => `${p.id}\t${p.message}`).join("\n")) {
    hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  }
  return `jev-annotations:${hash.toString(36)}`;
}

// localStorage can be missing or throw (private windows, blocked storage); progress then lives
// only in memory and the Download button is the way to keep it.
function readSaved(key: string): Annotations | null {
  try {
    const text = window.localStorage.getItem(key);
    return text ? (JSON.parse(text) as Annotations) : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, annotations: Annotations) {
  try {
    window.localStorage.setItem(key, JSON.stringify(annotations));
  } catch {
    // See readSaved.
  }
}

/** Typing in a field shouldn't trigger shortcuts. */
function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
}

/**
 * The annotation screen: one message at a time, a progress strip to jump around, and a summary.
 * Annotations autosave in this browser and can be downloaded as CSV (and imported again).
 */
export function Annotator({ initial, initialSource }: Props) {
  const [dataset, setDataset] = useState(initial);
  const [source, setSource] = useState(initialSource);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<"review" | "summary">("review");
  const [importError, setImportError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  // False in the server's HTML; true once the browser has taken over and shortcuts work.
  const [interactive, setInteractive] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { predictions, annotations } = dataset;
  const key = useMemo(() => storageKey(dataset), [dataset]);
  const summary = useMemo(() => summarize(dataset), [dataset]);
  const current = predictions[index];

  // Restore saved progress once, after the first render. It can't happen during render because the
  // server has no localStorage, and the first browser render must match the server's HTML.
  useEffect(() => {
    const saved = readSaved(storageKey(initial));
    if (saved && Object.keys(saved).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from browser storage
      setDataset((d) => ({ ...d, annotations: { ...d.annotations, ...saved } }));
      setRestored(true);
    }
    setInteractive(true);
  }, [initial]);

  function setAnnotations(next: Annotations) {
    setDataset((d) => ({ ...d, annotations: next }));
    writeSaved(key, next);
  }

  function save(annotation: Annotation) {
    if (!current) return;
    const next = { ...annotations, [current.id]: annotation };
    setAnnotations(next);
    // Move on to the next message without an answer; when there is none, show the results.
    const order = [...predictions.slice(index + 1), ...predictions.slice(0, index)];
    const nextOpen = order.find((p) => !next[p.id]);
    if (nextOpen) setIndex(predictions.indexOf(nextOpen));
    else setView("summary");
  }

  function go(to: number) {
    setIndex(Math.max(0, Math.min(predictions.length - 1, to)));
    setView("review");
  }

  async function importFile(file: File) {
    try {
      const imported = parseDataset(await file.text());
      // Work saved in this browser for the same messages is newer than the file, so it wins.
      const key = storageKey(imported);
      const saved = readSaved(key) ?? {};
      const annotations = { ...imported.annotations, ...saved };
      setDataset({ ...imported, annotations });
      writeSaved(key, annotations);
      setSource(file.name);
      setIndex(0);
      setView("review");
      setImportError(null);
      setRestored(Object.keys(saved).length > 0);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Couldn’t read that file.");
    }
  }

  // Clearing asks for a second click instead of window.confirm(), which some hosts block.
  function clearAll() {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    setConfirmingClear(false);
    setAnnotations({});
    setIndex(0);
    setView("review");
  }

  // Keyboard shortcuts. No dependency list, so the listener is re-attached after every render and
  // always sees the current message.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (view === "review" && event.key.toLowerCase() === "y") {
        document.querySelector<HTMLButtonElement>("[data-accept]")?.click();
      } else if (view === "review" && event.key.toLowerCase() === "n") {
        document.getElementById("expected-action")?.focus();
      } else return;
      event.preventDefault(); // e.g. don't type "n" into the field we just focused
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const done = summary.reviewed;
  const percent = Math.round((done / predictions.length) * 100);

  return (
    <div className="flex flex-col gap-6" data-interactive={interactive || undefined}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">Annotate Jev&apos;s predictions</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{source}</span> · {predictions.length} messages
              {restored && " · restored your saved progress"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Import predictions CSV"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = ""; // allow importing the same file again
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden="true" />
              Import CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void saveFile(`annotations-${new Date().toISOString().slice(0, 10)}.csv`, serializeDataset(dataset))
              }
            >
              <Download aria-hidden="true" />
              Download CSV
            </Button>
          </div>
        </div>
        {importError && (
          <p role="alert" className="text-sm text-destructive">
            {importError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="tabular-nums" data-testid="progress">
              {done} of {predictions.length} reviewed
            </span>
            <span className="text-muted-foreground tabular-nums">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Reviewed"
            aria-valuemin={0}
            aria-valuemax={predictions.length}
            aria-valuenow={done}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {/* One square per message: green right, amber wrong values, red wrong action, grey not yet. */}
        <nav aria-label="Messages" className="flex flex-wrap gap-1">
          {predictions.map((p, i) => {
            const a = annotations[p.id];
            const result = a ? verdict(p, a) : null;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Message ${i + 1}${result ? `, ${result.replace("_", " ")}` : ", not reviewed"}`}
                aria-current={view === "review" && i === index ? "true" : undefined}
                className={cn(
                  "size-6 rounded text-[10px] font-medium tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  result === null && "bg-muted text-muted-foreground",
                  result === "correct" && "bg-success/25 text-foreground",
                  result === "wrong_values" && "bg-warning/35 text-foreground",
                  result === "wrong_action" && "bg-destructive/20 text-destructive",
                  view === "review" && i === index && "ring-2 ring-foreground",
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => go(index - 1)} disabled={view === "review" && index === 0}>
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go(index + 1)}
            disabled={view === "review" && index === predictions.length - 1}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            variant={view === "summary" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView(view === "summary" ? "review" : "summary")}
            aria-pressed={view === "summary"}
          >
            Summary
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("ml-auto", confirmingClear ? "text-destructive" : "text-muted-foreground")}
            onClick={clearAll}
            onBlur={() => setConfirmingClear(false)}
          >
            {confirmingClear ? "Click again to clear every answer" : "Clear all"}
          </Button>
        </div>
      </header>

      {view === "summary" ? (
        <SummaryView
          summary={summary}
          onOpen={(id) => go(predictions.findIndex((p) => p.id === id))}
        />
      ) : (
        current && (
          <ReviewCard
            // A new key per message (and per saved answer) resets the form's pre-filled values.
            key={`${current.id}:${JSON.stringify(annotations[current.id] ?? null)}`}
            prediction={current}
            annotation={annotations[current.id]}
            position={index + 1}
            total={predictions.length}
            onSave={save}
          />
        )
      )}

      <p className="text-xs text-muted-foreground">
        Shortcuts: <kbd>Y</kbd> correct · <kbd>N</kbd> fix it · <kbd>Enter</kbd> save the fix · <kbd>←</kbd>{" "}
        <kbd>→</kbd> previous / next. Progress is saved in this browser; download the CSV to keep it.
      </p>
    </div>
  );
}
