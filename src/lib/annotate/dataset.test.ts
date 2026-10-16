import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { acceptPrediction, parseDataset, serializeDataset } from "./dataset";
import { summarize } from "./summary";

// Runs on the real predictions file the annotation page loads, not a hand-made sample.
const text = await readFile(new URL("../../../predictions.csv", import.meta.url), "utf8");

describe("the predictions CSV", () => {
  test("parses every message with its values and confidences", () => {
    const { predictions, annotations } = parseDataset(text);
    expect(predictions).toHaveLength(100);
    expect(annotations).toEqual({});
    expect(predictions[2]).toMatchObject({
      id: "3",
      message: "can you etransfer my landlord $1,850 for rent from chequing",
      predictedAction: "send_etransfer",
      actionConfidence: 0.99,
      params: {
        recipient: { value: "my landlord", confidence: 0.35 },
        amount: { value: "1850.00", confidence: 1 },
        from_account: { value: "chequing", confidence: 1 },
      },
    });
  });

  test("survives export and re-import with annotations, and scores them", () => {
    const dataset = parseDataset(text);
    const [first, second] = dataset.predictions;
    dataset.annotations = {
      [first!.id]: acceptPrediction(first!)!,
      [second!.id]: { expectedAction: "none", expectedParams: {}, note: 'says "hi", oddly' },
    };

    const reread = parseDataset(serializeDataset(dataset));

    expect(reread).toEqual(dataset);
    expect(summarize(reread)).toMatchObject({ reviewed: 2, action: { total: 2, correct: 1 } });
  });

  test("refuses a file that would silently lose rows or answers", () => {
    const header = "id,message,predicted_action,expected_action";
    expect(() => parseDataset(`${header}\n1,hi,none,\n1,hello,none,\n`)).toThrow("Line 3: id 1 appears more than once.");
    expect(() => parseDataset(`${header}\n1,hi,none,send_etransfr\n`)).toThrow('Line 2: "send_etransfr" isn\'t an action.');
  });
});
