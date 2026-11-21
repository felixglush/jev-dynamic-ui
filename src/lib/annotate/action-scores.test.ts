import { expect, test } from "vitest";

import { scoreActions } from "./action-scores";

test("precision and recall are told apart, and mix-ups are listed", () => {
  const result = scoreActions([
    { expected: "send_etransfer", predicted: "send_etransfer" },
    { expected: "send_etransfer", predicted: "send_etransfer" },
    { expected: "send_etransfer", predicted: "request_etransfer" }, // missed: lowers send recall
    { expected: "request_etransfer", predicted: "request_etransfer" },
    { expected: "none", predicted: "request_etransfer" }, // lowers request precision
  ]);
  const by = Object.fromEntries(result.perAction.map((r) => [r.action, r]));
  expect(result.accuracy).toBe(3 / 5);
  expect(by.send_etransfer).toMatchObject({ precision: 1, recall: 2 / 3 });
  expect(by.request_etransfer).toMatchObject({ precision: 1 / 3, recall: 1 });
  expect(by.none).toMatchObject({ precision: null, recall: 0 });
  expect(result.confusions).toHaveLength(2);
});
