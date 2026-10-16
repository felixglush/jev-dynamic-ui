import { describe, expect, it } from "vitest";

import { parseBatch } from "./batch";
import { addExamples } from "./examples";

const text = ["# send_etransfer", "# pattern: today-date", "# split: val", "send 5 to Sam today => recipient=Sam; amount=5; date=today", "# split:", "send 6 to Tia => recipient=Tia; amount=6", "# pattern:", "send 7 to Uma => recipient=Uma; amount=7"].join("\n");

describe("batch tags", () => {
  it("apply `# pattern:` and `# split:` lines to the rows below until they change", () => {
    const [a, b, c] = parseBatch(text);
    expect([a!.pattern, a!.split]).toEqual(["today-date", "val"]);
    expect([b!.pattern, b!.split]).toEqual(["today-date", undefined]);
    expect([c!.pattern, c!.split]).toEqual([undefined, undefined]);
  });

  it("reject a split that is not train, val or test", () => {
    expect(() => parseBatch("# split: dev\n# send_etransfer\nx =>")).toThrow(/Bad split/);
  });

  it("land in the row's meta, with batch tags beating the defaults", () => {
    const { records } = addExamples([], parseBatch(text), "synthetic", { split: "test", pattern: "other", version: "v2" });
    expect(records.map((r) => [r.meta.split, r.meta.pattern, r.meta.version])).toEqual([
      ["val", "today-date", "v2"],
      ["test", "today-date", "v2"],
      ["test", "other", "v2"],
    ]);
  });
});
