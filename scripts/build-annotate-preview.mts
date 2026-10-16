/**
 * Build a single self-contained HTML file of the annotation page, with predictions.csv embedded,
 * to share somewhere the Next.js server can't run (it was made for a Claude Artifact).
 *
 *   npm run build && npm run annotate:preview -- [predictions-csv] [output-html]
 *
 * It bundles the real <Annotator /> component with esbuild and inlines the Tailwind CSS from the
 * last `npm run build`, so the preview looks and behaves like /annotate. Differences: nothing is
 * rendered on the server, and Download goes through the Artifact host instead of a plain link.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { parseDataset } from "../src/lib/annotate/dataset";

const root = fileURLToPath(new URL("..", import.meta.url));
const [inputPath = "predictions.csv", outputPath = "annotate-preview.html"] = process.argv.slice(2);

const dataset = parseDataset(await readFile(inputPath, "utf8"));

const bundle = await build({
  entryPoints: [path.join(root, "scripts/annotate-preview/entry.tsx")],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  plugins: [
    {
      name: "preview-save-file",
      setup(b) {
        b.onResolve({ filter: /^@\/lib\/annotate\/save-file$/ }, () => ({
          path: path.join(root, "scripts/annotate-preview/save-file.ts"),
        }));
      },
    },
  ],
});
// Inline <script> content must never contain "</script".
const js = bundle.outputFiles[0]!.text.replaceAll("</script", "<\\/script");

const cssDir = path.join(root, ".next/static/chunks");
const cssFiles = (await readdir(cssDir).catch(() => [])).filter((f) => f.endsWith(".css"));
if (cssFiles.length === 0) throw new Error("No built CSS found. Run `npm run build` first.");
const css = (await Promise.all(cssFiles.map((f) => readFile(path.join(cssDir, f), "utf8"))))
  .join("\n")
  // next/font's @font-face rules point at files that aren't in the preview; Google Fonts serves Geist instead.
  .replaceAll(/@font-face\s*\{[^}]*\}/g, "");

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const data = JSON.stringify({ dataset, source: path.basename(inputPath) }).replaceAll("<", "\\u003c");
// The theme tokens, so an explicit light/dark choice in the host can win over the system setting.
const light = css.match(/:root\s*\{(\s*--background[^}]*)\}/)?.[1] ?? "";
const dark = css.match(/\.dark\s*\{([^}]*)\}/)?.[1] ?? "";

const html = `<title>Jev Annotator</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;600&display=swap">
<style>
${css}
:root { --font-geist-sans: "Geist"; --font-geist-mono: "Geist Mono"; }
/* Follow the viewer's explicit theme choice as well as the system setting. */
:root[data-theme="dark"] { ${dark} color-scheme: dark; }
@media (prefers-color-scheme: dark) { :root[data-theme="light"] { ${light} color-scheme: light; } }
</style>
<div class="flex min-h-full flex-col">
  <p class="mx-auto mt-4 w-full max-w-3xl px-4 text-xs text-muted-foreground">
    Preview: the app's /annotate page, built as one static file with ${dataset.predictions.length} predictions
    from ${escapeHtml(path.basename(inputPath))} embedded. Progress is kept in this browser; download the CSV to keep it.
  </p>
  <main id="main" class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-6 pb-24">
    <div id="annotate-root"></div>
  </main>
</div>
<script type="application/json" id="annotate-data">${data}</script>
<script>${js}</script>
`;
await writeFile(outputPath, html);
console.log(`Wrote ${outputPath} (${Math.round(html.length / 1024)} KB)`);
