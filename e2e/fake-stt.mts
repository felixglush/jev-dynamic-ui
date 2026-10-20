/**
 * A local stand-in for a speech-to-text server (POST /v1/audio/transcriptions), used by the browser tests.
 *
 * It ignores the audio and answers with the texts a test last set, one per request, the last one repeating:
 * `POST /__say` with `{"texts": ["Send $50", "Send $50 to Sam"]}` acts out someone speaking.
 * `{"fail": true}` makes transcription return 500, to test the error path. The browser tests record a beep from
 * Chromium's fake microphone, so passing tests say nothing about how well any real model hears speech.
 * It also lists models (GET /v1/models, one of them unavailable) and remembers which model each transcription asked for:
 * `GET /__seen` answers `{"models": [...]}` for the requests since the last `/__say`.
 * Run standalone with `node e2e/fake-stt.mts` (the Playwright config does this).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

const PORT = Number(process.env.FAKE_STT_PORT ?? 0);
let texts: string[] = [];
let calls = 0;
let failing = false;
let seen: (string | null)[] = [];

const server = http.createServer((req, res) => {
  let data = "";
  req.setEncoding("latin1");
  req.on("data", (chunk) => (data += chunk));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/__say") {
      ({ texts = [], fail: failing = false } = JSON.parse(data) as { texts?: string[]; fail?: boolean });
      calls = 0;
      seen = [];
      return void res.end("{}");
    }
    if (req.url === "/__seen") return void res.end(JSON.stringify({ models: seen }));
    if (req.method === "GET" && req.url === "/v1/models") {
      return void res.end(
        JSON.stringify({
          default: "fast",
          data: [
            { id: "fast", label: "Fast model", available: true },
            { id: "accurate", label: "Accurate model", available: true },
            { id: "gone", label: "Missing model", available: false },
          ],
        }),
      );
    }
    if (req.method === "POST" && req.url === "/v1/audio/transcriptions") {
      seen.push(/name="model"\r\n\r\n([^\r]*)/.exec(data)?.[1] ?? null);
      res.statusCode = failing ? 500 : 200;
      return void res.end(JSON.stringify(failing ? { error: "down" } : { text: texts[Math.min(calls++, texts.length - 1)] ?? "" }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`fake STT listening on ${(server.address() as AddressInfo).port}`));
