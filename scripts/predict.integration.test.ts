/**
 * Runs the real `npm run predict` script as a subprocess against the local fake Jev, then checks the
 * CSV a person would open to validate predictions.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";

import { startFakeJev } from "../e2e/fake-jev.mts";

const run = promisify(execFile);
let fake: Awaited<ReturnType<typeof startFakeJev>>;

beforeAll(async () => {
  fake = await startFakeJev();
});
afterAll(() => fake.close());

it("writes one CSV row per message with predictions and an empty expected_action column", async () => {
  const dir = await mkdtemp(join(tmpdir(), "predict-"));
  const input = join(dir, "messages.txt");
  const output = join(dir, "out.csv");
  await writeFile(input, "# send_etransfer\nSend $50 to Sam for dinner\n# no action\nhello?\n");

  await run("npx", ["tsx", "--conditions=react-server", "scripts/predict.mts", input, output], {
    env: { ...process.env, TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: fake.url },
  });

  const lines = (await readFile(output, "utf8")).trim().split("\n");
  expect(lines[0]).toBe(
    "id,group,message,predicted_action,action_confidence,params,missing_required,expected_action,note",
  );
  expect(lines[1]).toBe(
    "1,send_etransfer,Send $50 to Sam for dinner,send_etransfer,0.930,,recipient; amount,,",
  );
  expect(lines[2]).toBe("2,no action,hello?,none,0.930,,,,");
}, 60_000);
