import type { Metadata } from "next";

import { addApprovedExample, extractMessageFields, loadSavedAnnotations, messageSplits, loadSftAnnotations, loadSftReviews, saveAnnotationsToFile, saveSftReviews } from "@/app/annotate/actions";
import { Workspace } from "@/components/annotate/workspace";
import { DEFAULT_PREDICTIONS_FILE, loadDefaultDataset } from "@/lib/annotate/load";

export const metadata: Metadata = {
  title: "Annotate predictions",
  description: "Mark each of Jev's and LiquidFM's predictions right or wrong, and see how accurate it is.",
};

// A Server Component: it reads predictions.csv on the server and hands the parsed rows to the
// <Workspace /> client component, which does everything interactive in the browser. The Server
// Actions let it keep annotations in files on this machine as well as in the browser.
export default async function AnnotatePage() {
  const dataset = await loadDefaultDataset();
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-10 pb-24">
      <Workspace
        jev={{
          initial: dataset,
          source: DEFAULT_PREDICTIONS_FILE,
          loadFromFile: loadSavedAnnotations,
          saveToFile: saveAnnotationsToFile,
          extract: extractMessageFields,
          addToTraining: addApprovedExample,
          lookupSplits: messageSplits,
        }}
        sft={{ load: loadSftReviews, loadAnnotations: loadSftAnnotations, save: saveSftReviews }}
      />
    </main>
  );
}
