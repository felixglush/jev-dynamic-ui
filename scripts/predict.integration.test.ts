/**
 * Runs the real `npm run predict` script as a subprocess against the local fake Jev, then checks the
 * CSV a person would open to validate predictions.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";

import { startFakeJev } from "../e2e/fake-jev.mts";

const run = promisify(execFile);
let fake: Awaited<ReturnType<typeof startFakeJev>>;
let ollama: ChildProcess;
let ollamaPort: number;

beforeAll(async () => {
  fake = await startFakeJev();
  // The script needs the extractor too; use the same fake Ollama as the browser tests, on a free port.
  ollamaPort = await new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
  ollama = spawn("node", ["e2e/fake-ollama.mts"], { env: { ...process.env, FAKE_OLLAMA_PORT: String(ollamaPort) } });
  await new Promise<void>((resolve) => ollama.stdout!.once("data", () => resolve()));
});
afterAll(async () => {
  ollama.kill();
  await fake.close();
});

it("writes one CSV row per message with predictions and an empty expected_action column", async () => {
  const dir = await mkdtemp(join(tmpdir(), "predict-"));
  const input = join(dir, "messages.txt");
  const output = join(dir, "out.csv");
  await writeFile(input, "# send_etransfer\nSend $50 to Sam for dinner\n# no action\nhello?\n");

  await run("npx", ["tsx", "--conditions=react-server", "scripts/predict.mts", input, output], {
    env: { ...process.env, TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: fake.url, OLLAMA_URL: `http://127.0.0.1:${ollamaPort}` },
  });

  const lines = (await readFile(output, "utf8")).trim().split("\n");
  expect(lines[0]).toBe(
    "id,group,message,predicted_action,action_confidence,params,missing_required,expected_action,note",
  );
  expect(lines[1]).toBe(
    "1,send_etransfer,Send $50 to Sam for dinner,send_etransfer,0.930,recipient=Sam; amount=50.00,,,",
  );
  expect(lines[2]).toBe("2,no action,hello?,none,0.930,,,,");
}, 60_000);
