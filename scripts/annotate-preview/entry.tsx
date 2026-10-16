// Entry point of the standalone preview: the same <Annotator /> the /annotate page renders, mounted
// in the browser with the predictions embedded in the HTML instead of read by the server.
import { createRoot } from "react-dom/client";

import { Annotator } from "@/components/annotate/annotator";
import type { Dataset } from "@/lib/annotate/dataset";

const data = JSON.parse(document.getElementById("annotate-data")!.textContent!) as {
  dataset: Dataset;
  source: string;
};

createRoot(document.getElementById("annotate-root")!).render(
  <Annotator initial={data.dataset} initialSource={data.source} />,
);
