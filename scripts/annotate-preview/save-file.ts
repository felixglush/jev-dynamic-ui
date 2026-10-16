// Replaces src/lib/annotate/save-file.ts in the preview. Claude Artifacts block downloads a page
// starts itself, so ask the host to offer the file instead (the "downloads" capability).
type Downloads = { save(request: { filename: string; data: string }): Promise<unknown> };
type Host = { use(name: "downloads"): Promise<Downloads | null> };

export async function saveFile(filename: string, text: string): Promise<void> {
  const host = (window as unknown as { claude?: Host }).claude;
  const downloads = await host?.use("downloads");
  if (!downloads) {
    window.alert("Downloads aren't available in this view.");
    return;
  }
  try {
    await downloads.save({ filename, data: text });
  } catch {
    // Declined or unavailable; the viewer already saw the host's prompt, so there's nothing to add.
  }
}
