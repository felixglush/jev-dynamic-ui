import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type { ClassifyResult } from "@/lib/jev/types";
import { parseCsv } from "./predictions-csv";
import { logPrediction } from "./log";

it("logs Jev's answer and the extractor's fields in separate columns", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "log-")), "p.csv");
  process.env.PREDICTIONS_LOG_FILE = file;
  const result = { action: "send_etransfer", confidence: 0.9, params: { recipient: { value: "Sam", confidence: 0.9 }, amount: { value: "50.00", confidence: 0.5 } }, missing: [] } as unknown as ClassifyResult;
  await logPrediction("Send $50 to Sam", result, { recipient: "Sam", amount: "50", date: "" });
  await logPrediction("Send $20, please", result, null);

  const [header, first, second] = parseCsv(await readFile(file, "utf8"));
  const col = (row: string[] | undefined, name: string) => row?.[header!.indexOf(name)];
  expect(col(first, "params")).toContain("recipient=Sam (0.90)");
  expect(col(first, "extracted")).toBe("recipient=Sam; amount=50; date=");
  expect(col(first, "extractor")).toMatch(/\S/);
  expect(col(second, "message")).toBe("Send $20, please");
  expect(col(second, "extracted")).toBe("");
  expect(col(second, "extractor")).toBe("");
});
