/**
 * Builds the app once and runs it twice, on two ports, differing only in the speech settings: the first has no
 * streaming server (the mic button records, then transcribes), the second has STT_STREAM_URL (the mic button
 * streams). Playwright starts this as one web server and stops it by signal, which stops both.
 *   node e2e/start-apps.mts <port> <streaming port> <streaming server url>
 */
import { spawn, spawnSync } from "node:child_process";

const [port, streamingPort, streamUrl] = process.argv.slice(2);

const build = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const start = (appPort: string, env: Record<string, string>) =>
  spawn("npm", ["run", "start", "--", "-p", appPort], { stdio: "inherit", env: { ...process.env, ...env } });
const apps = [start(port!, {}), start(streamingPort!, { STT_STREAM_URL: streamUrl! })];

const stopAll = () => {
  for (const app of apps) app.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGTERM", stopAll);
process.on("SIGINT", stopAll);
for (const app of apps) app.on("exit", () => process.exit(1));
