"use client";

import { useState } from "react";

import type { ExtractResult, LoadResult, TrainingResult, SaveResult, SftLoadResult } from "@/app/annotate/actions";
import { Button } from "@/components/ui/button";
import type { Annotation, Dataset } from "@/lib/annotate/dataset";
import { Annotator } from "./annotator";

type Changes = Record<string, Annotation | null>;

type Props = {
  jev: {
    initial: Dataset;
    source: string;
    loadFromFile: () => Promise<LoadResult>;
    saveToFile: (changes: Changes) => Promise<SaveResult>;
    /** Left out in the static preview. */
    extract?: (action: string, message: string) => Promise<ExtractResult>;
    addToTraining?: (row: { action: string; message: string; params: Record<string, string>; kind: string; note: string }) => Promise<TrainingResult>;
  };
  sft: {
    load: () => Promise<SftLoadResult>;
    loadAnnotations: () => Promise<LoadResult>;
    save: (changes: Changes) => Promise<SaveResult>;
  };
};

type Sft = { state: "idle" } | { state: "loading" } | { state: "error"; message: string } | { state: "ready"; dataset: Dataset; path: string };

/**
 * One page, two data sets: Jev's predictions (predictions.csv) and the generated fine-tuning rows
 * (data/sft/examples.jsonl). Both use the same review screen. The fine-tuning rows are read from the
 * server when you switch to them, because every answer is written back into that file.
 */
export function Workspace({ jev, sft }: Props) {
  const [source, setSource] = useState<"jev" | "sft">("jev");
  const [loaded, setLoaded] = useState<Sft>({ state: "idle" });

  async function choose(next: "jev" | "sft") {
    setSource(next);
    if (next === "jev") return;
    setLoaded({ state: "loading" });
    const result = await sft.load().catch(() => null);
    if (result?.ok) setLoaded({ state: "ready", dataset: result.dataset, path: result.path });
    else setLoaded({ state: "error", message: result?.ok === false ? result.error : "Couldn't reach the server." });
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Data set" className="flex w-fit rounded-md border">
        <Button variant={source === "jev" ? "secondary" : "ghost"} size="sm" aria-pressed={source === "jev"} onClick={() => void choose("jev")}>
          Jev predictions
        </Button>
        <Button variant={source === "sft" ? "secondary" : "ghost"} size="sm" aria-pressed={source === "sft"} onClick={() => void choose("sft")}>
          Fine-tuning data
        </Button>
      </div>

      {source === "jev" ? (
        <Annotator
          key="jev"
          initial={jev.initial}
          initialSource={jev.source}
          loadFromFile={jev.loadFromFile}
          saveToFile={jev.saveToFile}
          extract={jev.extract}
          addToTraining={jev.addToTraining}
        />
      ) : loaded.state === "ready" ? (
        <Annotator
          key="sft"
          title="Review the fine-tuning data"
          defaultMode="fields"
          persistLocal={false}
          initial={loaded.dataset}
          initialSource={loaded.path}
          loadFromFile={sft.loadAnnotations}
          saveToFile={sft.save}
        />
      ) : loaded.state === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t open the fine-tuning file: {loaded.message}
        </p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the fine-tuning data…
        </p>
      )}
    </div>
  );
}
