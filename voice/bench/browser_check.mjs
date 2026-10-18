// Plays a real speech clip into Chromium's fake microphone and watches the app's message bar fill in while it plays.
// A manual end-to-end check of mic -> AudioWorklet -> WebSocket -> speech server -> app (the automated browser tests use
// fakes). Needs: the built app running with STT_STREAM_URL pointing at the speech server (and the e2e fakes or real
// Jev/Ollama behind it), and a 16-bit WAV clip.
//   PW_CHROMIUM_PATH=... node voice/bench/browser_check.mjs CLIP.wav [APP_URL]
import { chromium } from "@playwright/test";

const [clip, appUrl = "http://localhost:3200/"] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${clip}%noloop`],
});
const page = await browser.newPage();
await page.goto(appUrl);
await page.waitForFunction(() => document.querySelector('button[aria-label="Record a message"]')?.disabled === false);
const started = Date.now();
await page.getByRole("button", { name: "Record a message" }).click();
const bar = page.getByLabel("Message", { exact: true });
let last = "";
while (Date.now() - started < 6000) {
  const text = await bar.inputValue();
  if (text !== last) console.log(`${String(Date.now() - started).padStart(5)} ms  ${text}`), (last = text);
  await page.waitForTimeout(50);
}
await page.getByRole("button", { name: "Stop recording" }).click();
await page.waitForTimeout(1500);
console.log("after stop:", await bar.inputValue());
await browser.close();
