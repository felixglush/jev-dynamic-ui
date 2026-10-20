/**
 * Builds the app once and runs it three times, on three ports, differing only in the speech settings: the first has
 * no streaming server (the mic button records, then transcribes), the second has STT_STREAM_URL (the mic button
 * streams), the third streams too but keeps the text out of the bar while speaking and has the batch engine
 * re-hear the recording at the end (STT_LIVE_TEXT=off, STT_REFINE=on). Playwright starts this as one web server and
 * stops it by signal, which stops all of them.
 *   node e2e/start-apps.mts <port> <streaming port> <streaming server url> <live form port>
 */
import { spawn, spawnSync } from "node:child_process";

const [port, streamingPort, streamUrl, liveFormPort] = process.argv.slice(2);

const build = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const start = (appPort: string, env: Record<string, string>) =>
  spawn("npm", ["run", "start", "--", "-p", appPort], { stdio: "inherit", env: { ...process.env, ...env } });
const apps = [
  start(port!, {}),
  start(streamingPort!, { STT_STREAM_URL: streamUrl! }),
  start(liveFormPort!, { STT_STREAM_URL: streamUrl!, STT_LIVE_TEXT: "off", STT_REFINE: "on" }),
];

const stopAll = () => {
  for (const app of apps) app.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGTERM", stopAll);
process.on("SIGINT", stopAll);
for (const app of apps) app.on("exit", () => process.exit(1));
