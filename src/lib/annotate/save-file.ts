/**
 * Hand a generated file to the browser as a download. Kept in its own module so the standalone
 * preview (scripts/build-annotate-preview.mts) can swap in a version for hosts that block
 * script-started downloads.
 */
export async function saveFile(filename: string, text: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
