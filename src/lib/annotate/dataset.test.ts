import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { acceptPrediction, annotationsFor, parseDataset, sanitizeAnnotations, serializeDataset } from "./dataset";
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
      // Separators and the escape character inside a value must survive the trip.
      ["3"]: { expectedAction: "send_etransfer", expectedParams: { recipient: "Smith; Jr 100%3B" }, note: "" },
    };

    const reread = parseDataset(serializeDataset(dataset));

    expect(reread).toEqual(dataset);
    expect(summarize(reread)).toMatchObject({ reviewed: 3, action: { total: 3, correct: 2 } });
  });

  test("refuses a file that would silently lose rows or answers", () => {
    const header = "id,message,predicted_action,expected_action";
    expect(() => parseDataset(`${header}\n1,hi,none,\n1,hello,none,\n`)).toThrow("Line 3: id 1 appears more than once.");
    expect(() => parseDataset(`${header}\n1,hi,none,send_etransfr\n`)).toThrow('Line 2: "send_etransfr" isn\'t an action.');
  });

  test("sanitizes annotations from the browser before they are written", () => {
    const { predictions } = parseDataset(text);
    const clean = sanitizeAnnotations(predictions, {
      "3": {
        expectedAction: "send_etransfer",
        expectedParams: { recipient: "  landlord ", amount: "1850", bogus: "x", from_account: 7 },
        note: "n".repeat(900),
      },
    });
    expect(clean["3"]?.expectedParams).toEqual({ recipient: "landlord", amount: "1850" });
    expect(clean["3"]?.note).toHaveLength(500);

    expect(() => sanitizeAnnotations(predictions, { "999": { expectedAction: "none" } })).toThrow("Unknown message id 999");
    expect(() => sanitizeAnnotations(predictions, { "1": { expectedAction: "wire_money" } })).toThrow("isn't an action");
    expect(() => sanitizeAnnotations(predictions, [])).toThrow("must be an object");
  });

  test("only reuses saved answers whose message text is unchanged", () => {
    const dataset = parseDataset(text);
    const answer = { expectedAction: "none", expectedParams: {}, note: "" } as const;
    const saved = parseDataset(
      serializeDataset({
        predictions: dataset.predictions.map((p) => (p.id === "2" ? { ...p, message: "a different message" } : p)),
        annotations: { "1": answer, "2": answer },
      }),
    );

    expect(Object.keys(annotationsFor(dataset.predictions, saved))).toEqual(["1"]);
  });
});
