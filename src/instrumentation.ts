// Runs once when the Next.js server starts. Loads the extractor model into Ollama now, so the first message
// doesn't wait for a model load (about 10 s from a cold disk).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { preloadExtractor } = await import("@/lib/extract/ollama");
  void preloadExtractor();
}
