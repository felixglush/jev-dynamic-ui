"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LoadResult, SaveResult } from "@/app/annotate/actions";
import { label, parseAnyDataset, serializeDataset, serializeLabels, type Annotation, type Annotations, type Dataset } from "@/lib/annotate/dataset";
import { saveFile } from "@/lib/annotate/save-file";
import { summarize, verdict } from "@/lib/annotate/summary";
import { cn } from "@/lib/utils";
import { ReviewCard, type ReviewMode } from "./review-card";
import { SummaryView } from "./summary-view";

type Props = {
  initial: Dataset;
  initialSource: string;
  /** Read annotations saved in a file on the server. Left out in the static preview. */
  loadFromFile?: () => Promise<LoadResult>;
  /** Write every annotation to that file. Left out in the static preview. */
  saveToFile?: (changes: Changes) => Promise<SaveResult>;
  /** Heading above the progress. */
  title?: string;
  /** Which view opens first. */
  defaultMode?: ReviewMode;
  /** Keep a copy in this browser too. Off when the file on the server is the only source of truth. */
  persistLocal?: boolean;
};

/** Where the annotations last went: a file on the server, or only this browser. */
/** A message id → its new annotation, or null when the answer was removed. */
type Changes = Record<string, Annotation | null>;

function changesBetween(before: Annotations, after: Annotations): Changes {
  const changes: Changes = {};
  for (const [id, annotation] of Object.entries(after)) {
    if (JSON.stringify(before[id]) !== JSON.stringify(annotation)) changes[id] = annotation;
  }
  for (const id of Object.keys(before)) if (!(id in after)) changes[id] = null;
  return changes;
}

type FileStatus =
  | { state: "idle" }
  | { state: "saving"; path: string }
  | { state: "saved"; path: string }
  | { state: "error"; message: string };

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

function FileStatusText({ status, enabled, usingDefault }: { status: FileStatus; enabled: boolean; usingDefault: boolean }) {
  if (!enabled) return null;
  let text = "";
  if (!usingDefault) text = "Imported file: saved in this browser only";
  else if (status.state === "saving") text = "Saving…";
  else if (status.state === "saved") text = status.path ? `Saved to ${status.path}` : "";
  else if (status.state === "error") text = status.message;
  return (
    <span
      role="status"
      data-testid="file-status"
      className={cn("mx-3 min-w-0 flex-1 truncate text-xs", status.state === "error" && usingDefault ? "text-destructive" : "text-muted-foreground")}
    >
      {text}
    </span>
  );
}

/** How many group blocks of squares are visible before the grid scrolls. */
const GROUPS_SHOWN = 3;

/** Typing in a field shouldn't trigger shortcuts. */
function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
}

/**
 * The annotation screen: one message at a time, a progress strip to jump around, and a summary.
 * Annotations autosave in this browser and can be downloaded as CSV (and imported again).
 */
export function Annotator({ initial, initialSource, loadFromFile, saveToFile, title = "Annotate Jev's predictions", defaultMode = "full", persistLocal = true }: Props) {
  const [dataset, setDataset] = useState(initial);
  const [source, setSource] = useState(initialSource);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<"review" | "summary">("review");
  const [mode, setMode] = useState<ReviewMode>(defaultMode);
  // Which group of messages to walk through ("" = all of them).
  const [group, setGroup] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  // False in the server's HTML; true once the browser has taken over and shortcuts work.
  const [interactive, setInteractive] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Autosave to the file only covers the default predictions; an imported CSV stays in the browser.
  const [usingDefault, setUsingDefault] = useState(true);
  const usingDefaultRef = useRef(true);
  const [fileStatus, setFileStatus] = useState<FileStatus>({ state: "idle" });
  // The file couldn't be read (say, edited by hand into something invalid): don't overwrite it.
  const fileBlocked = useRef(false);
  // Changes not yet written to the file, and the newest annotations this session has set.
  const pending = useRef<Changes | null>(null);
  const latest = useRef<Annotations>({});
  const writing = useRef(false);

  const { predictions: allPredictions, annotations } = dataset;
  const groups = useMemo(() => {
    const tally = new Map<string, { total: number; reviewed: number }>();
    for (const p of allPredictions) {
      const t = tally.get(p.group) ?? { total: 0, reviewed: 0 };
      t.total += 1;
      if (annotations[p.id]) t.reviewed += 1;
      tally.set(p.group, t);
    }
    return [...tally].sort(([a], [b]) => a.localeCompare(b));
  }, [allPredictions, annotations]);
  // The messages being walked through: one group, or everything. Progress and the summary stay global.
  const predictions = useMemo(() => (group ? allPredictions.filter((p) => p.group === group) : allPredictions), [allPredictions, group]);
  const key = useMemo(() => storageKey(dataset), [dataset]);
  const summary = useMemo(() => summarize(dataset), [dataset]);
  const current = predictions[index];
  // The grid scrolls and is as tall as its first GROUPS_SHOWN blocks, so that many groups show at once.
  const gridRef = useRef<HTMLElement>(null);
  const [gridHeight, setGridHeight] = useState<number>();
  // The squares, one block per group in the order groups first appear. Numbers follow the walk order.
  const squareGroups = useMemo(() => {
    const blocks = new Map<string, { p: (typeof predictions)[number]; i: number }[]>();
    predictions.forEach((p, i) => blocks.set(p.group, [...(blocks.get(p.group) ?? []), { p, i }]));
    return [...blocks].map(([name, items]) => ({ name, items }));
  }, [predictions]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const blocks = [...grid.children].slice(0, GROUPS_SHOWN) as HTMLElement[];
    const last = blocks.at(-1);
    // Blocks can be taller than the window shows; scroll their group into view when you jump to a message.
    setGridHeight(last && grid.children.length > GROUPS_SHOWN ? last.offsetTop - grid.offsetTop + last.offsetHeight : undefined);
  }, [squareGroups, allPredictions.length]);
  useEffect(() => {
    gridRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index, group, view]);

  // Restore saved progress once, after the first render. It can't happen during render because the
  // server has no localStorage, and the first browser render must match the server's HTML.
  // Progress in this browser is newer than the file, so it wins where the two disagree.
  useEffect(() => {
    const local = (persistLocal && readSaved(storageKey(initial))) || {};
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from browser storage
    setInteractive(true);
    void (async () => {
      let fromFile: Annotations = {};
      if (loadFromFile) {
        const loaded = await loadFromFile().catch(() => null);
        if (loaded === null || !loaded.ok) {
          fileBlocked.current = true;
          setFileStatus({
            state: "error",
            message: loaded?.ok === false ? `Couldn't read the saved file: ${loaded.error}` : "Couldn't reach the server to read the saved file.",
          });
        } else {
          fromFile = loaded.annotations ?? {};
          // No file yet: stay quiet until the first write creates it.
          if (loaded.annotations) setFileStatus({ state: "saved", path: loaded.path });
        }
      }
      const merged = { ...fromFile, ...local };
      // If a CSV was imported while the file was loading, these answers belong to the other dataset.
      if (usingDefaultRef.current && Object.keys(merged).length > 0) {
        // Answers given while the file was loading are newer than anything restored, so they win.
        setDataset((d) => ({ ...d, annotations: { ...merged, ...d.annotations } }));
        if (persistLocal) writeSaved(storageKey(initial), { ...merged, ...latest.current });
        setRestored(true);
        // Anything only the browser had goes to the file too, except what was answered since.
        const browserOnly = Object.keys(local).filter((id) => !(id in latest.current) && JSON.stringify(local[id]) !== JSON.stringify(fromFile[id]));
        if (browserOnly.length > 0) queueFileSave(Object.fromEntries(browserOnly.map((id) => [id, local[id]!])));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; the props are stable
  }, [initial]);

  /** Send changed answers to the file. Changes made while a save is running go out together in the next one. */
  function queueFileSave(changes: Changes) {
    if (!saveToFile || !usingDefaultRef.current || fileBlocked.current) return;
    pending.current = { ...pending.current, ...changes };
    if (writing.current) return;
    writing.current = true;
    void (async () => {
      let failed = false;
      let path = "";
      while (pending.current) {
        const batch = pending.current;
        pending.current = null;
        setFileStatus((s) => (s.state === "saved" || s.state === "saving" ? { state: "saving", path: s.path } : { state: "saving", path: "" }));
        const result = await saveToFile(batch).catch(() => null);
        if (result?.ok) path = result.path;
        else {
          // Keep these changes for the next try, under anything newer, and stop until the next edit.
          pending.current = { ...batch, ...(pending.current as Changes | null) };
          failed = true;
          break;
        }
      }
      writing.current = false;
      setFileStatus(
        failed
          ? { state: "error", message: "Couldn't write the file. Your progress is still saved in this browser." }
          : { state: "saved", path },
      );
    })();
  }

  function setAnnotations(next: Annotations) {
    setDataset((d) => ({ ...d, annotations: next }));
    if (persistLocal) writeSaved(key, next);
    latest.current = next;
    queueFileSave(changesBetween(annotations, next));
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
      const imported = parseAnyDataset(await file.text());
      // Work saved in this browser for the same messages is newer than the file, so it wins.
      const key = storageKey(imported);
      const saved = readSaved(key) ?? {};
      const annotations = { ...imported.annotations, ...saved };
      setDataset({ ...imported, annotations });
      writeSaved(key, annotations);
      setSource(file.name);
      usingDefaultRef.current = false;
      setUsingDefault(false);
      setIndex(0);
      setGroup("");
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
  const percent = Math.round((done / allPredictions.length) * 100);

  return (
    <div className="flex flex-col gap-6" data-interactive={interactive || undefined}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{source}</span> · {allPredictions.length} messages
              {restored && " · restored your saved progress"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.jsonl,text/csv,application/jsonl,application/json"
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
              Import file
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
            <Button
              variant="outline"
              size="sm"
              title="Reviewed answers as message => field=value lines (the batch format npm run sft:add reads)"
              onClick={() => void saveFile(`labels-${new Date().toISOString().slice(0, 10)}.txt`, serializeLabels(dataset))}
            >
              <Download aria-hidden="true" />
              Download labels
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
              {done} of {allPredictions.length} reviewed
            </span>
            <FileStatusText status={fileStatus} enabled={Boolean(saveToFile)} usingDefault={usingDefault} />
            <span className="text-muted-foreground tabular-nums">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Reviewed"
            aria-valuemin={0}
            aria-valuemax={allPredictions.length}
            aria-valuenow={done}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {/* One square per message: green right, amber wrong values, red wrong action, grey not yet. */}
        <nav
          ref={gridRef}
          aria-label="Messages"
          tabIndex={0}
          style={{ maxHeight: gridHeight }}
          className="flex flex-col gap-3 overflow-y-auto overscroll-contain rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {squareGroups.map(({ name, items }) => (
            <div key={name} role="group" aria-label={name ? label(name) : "Messages"} className="flex flex-col gap-1">
              {name && squareGroups.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  {label(name)} · {items.filter(({ p }) => annotations[p.id]).length}/{items.length}
                </span>
              )}
              <div className="flex flex-wrap gap-1">
                {items.map(({ p, i }) => {
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
              </div>
            </div>
          ))}
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
          <div role="group" aria-label="What to show" className="flex rounded-md border">
            {(["full", "fields"] as const).map((option) => (
              <Button
                key={option}
                variant={mode === option ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={mode === option}
                onClick={() => {
                  setMode(option);
                  setView("review");
                }}
              >
                {option === "full" ? "Full" : "Fields only"}
              </Button>
            ))}
          </div>
          {groups.length > 1 && (
            <select
              aria-label="Group"
              value={group}
              onChange={(event) => {
                setGroup(event.target.value);
                setIndex(0);
                setView("review");
              }}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">All groups ({allPredictions.length})</option>
              {groups.map(([name, t]) => (
                <option key={name} value={name}>
                  {label(name)} ({t.reviewed}/{t.total})
                </option>
              ))}
            </select>
          )}
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
          onOpen={(id) => {
            setGroup("");
            setIndex(allPredictions.findIndex((p) => p.id === id));
            setView("review");
          }}
        />
      ) : (
        current && (
          <ReviewCard
            // A new key per message (and per saved answer) resets the form's pre-filled values.
            key={`${current.id}:${mode}:${JSON.stringify(annotations[current.id] ?? null)}`}
            mode={mode}
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
