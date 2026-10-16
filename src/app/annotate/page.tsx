import type { Metadata } from "next";

import { loadSavedAnnotations, saveAnnotationsToFile } from "@/app/annotate/actions";
import { Annotator } from "@/components/annotate/annotator";
import { DEFAULT_PREDICTIONS_FILE, loadDefaultDataset } from "@/lib/annotate/load";

export const metadata: Metadata = {
  title: "Annotate predictions",
  description: "Mark each of Jev's predictions right or wrong, and see how accurate it is.",
};

// A Server Component: it reads predictions.csv on the server and hands the parsed rows to the
// <Annotator /> client component, which does everything interactive in the browser. The two Server
// Actions let it keep annotations in a file on this machine as well as in the browser.
export default async function AnnotatePage() {
  const dataset = await loadDefaultDataset();
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-10 pb-24">
      <Annotator
        initial={dataset}
        initialSource={DEFAULT_PREDICTIONS_FILE}
        loadFromFile={loadSavedAnnotations}
        saveToFile={saveAnnotationsToFile}
      />
    </main>
  );
}
