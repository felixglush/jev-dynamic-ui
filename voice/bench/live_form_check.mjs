// Times how soon the form reacts to speech: plays a speech clip into Chromium's fake microphone and prints, per run,
// when the form opened, when each field filled, and when the final text reached the message bar (ms after Record).
// Needs the built app running with STT_STREAM_URL pointing at the speech server and real Jev and Ollama behind it.
//   PW_CHROMIUM_PATH=... node voice/bench/live_form_check.mjs CLIP.wav [RUNS] [APP_URL]
import { chromium } from "@playwright/test";

const [clip, runs = "4", appUrl = "http://localhost:3200/"] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${clip}%noloop`],
});
for (let run = 1; run <= Number(runs); run++) {
  const page = await browser.newPage();
  await page.goto(appUrl);
  await page.waitForFunction(() => document.querySelector('button[aria-label="Record a message"]')?.disabled === false);
  await page.evaluate(() => {
    const started = performance.now();
    const seen = (window.__seen = {});
    const note = (key) => (seen[key] ??= Math.round(performance.now() - started));
    setInterval(() => {
      const card = document.querySelector('[role="dialog"]');
      if (card?.getAttribute("data-open") === "true" && card.querySelector("h2")) note(`form opens: ${card.querySelector("h2").textContent}`);
      for (const input of card?.querySelectorAll("input") ?? []) if (input.value) note(`${input.name}=${input.value}`);
      const bar = document.querySelector('input[name="message"]');
      if (bar.value) note(`bar: ${bar.value}`);
    }, 10);
  });
  await page.getByRole("button", { name: "Record a message" }).click();
  await page.waitForTimeout(7000);
  console.log(`run ${run}`, JSON.stringify(await page.evaluate(() => window.__seen)));
  await page.close();
}
await browser.close();
