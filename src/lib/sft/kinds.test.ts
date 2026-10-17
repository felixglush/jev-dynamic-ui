import { describe, expect, it } from "vitest";

import { parseBatch } from "./batch";
import { addExamples, applyReview, reviewOf } from "./examples";
import { guessKind, isKind } from "./kinds";

describe("kinds", () => {
  it("uses a pattern's kind first, then plain rules on the message", () => {
    expect(guessKind("send 5 to sam", {}, "typo-field")).toBe("typo");
    expect(guessKind("send $5,000.50 to María-José", { recipient: "María-José" })).toBe("accented-name");
    expect(guessKind("send Mom 200 bucks", { recipient: "Mom" })).toBe("worded-number");
    expect(guessKind("send Priya $100 on December 24", { recipient: "Priya" })).toBe("date");
    expect(guessKind("Spotify charged me $11.99 but my plan is $9.99", {})).toBe("multiple-numbers");
    expect(guessKind("pay down some debt, maybe $300", { amount: "300" })).toBe("plain");
    expect(guessKind("add priya.k@example.com as a contact", { email: "priya.k@example.com" })).toBe("contact-details");
    expect(guessKind("send $1.5k to Noah", { amount: "1500" })).toBe("worded-number");
    expect(guessKind("give my son some money", {})).toBe("missing-info");
  });

  it("reads `# kind:` lines in a batch and rejects unknown kinds", () => {
    const [a, b] = parseBatch("# send_etransfer\n# kind: typo\nsnd 5 to Sam => recipient=Sam; amount=5\n# kind:\nsend 6 to Tia => recipient=Tia; amount=6");
    expect([a!.kind, b!.kind]).toEqual(["typo", undefined]);
    expect(() => parseBatch("# send_etransfer\n# kind: nonsense\nx => recipient=Sam")).toThrow(/Bad kind/);
    expect(isKind("typo")).toBe(true);
  });

  it("gives new rows a kind, keeps it through a review and lets the reviewer change it", () => {
    const { records } = addExamples([], parseBatch("# send_etransfer\nsend $5 to Zoë => recipient=Zoë; amount=5"), "synthetic");
    expect(records[0]!.meta.kind).toBe("accented-name");
    const reviewed = applyReview(records[0]!, { expectedAction: "send_etransfer", expectedParams: { recipient: "Zoë", amount: "5" } });
    expect(reviewed.meta.kind).toBe("accented-name");
    const changed = applyReview(reviewed, { expectedAction: "send_etransfer", expectedParams: { recipient: "Zoë", amount: "5" }, kind: "unusual-name" });
    expect(reviewOf(changed)?.kind).toBe("unusual-name");
    expect(applyReview(changed, { expectedAction: "none", expectedParams: {}, kind: "bogus" }).meta.kind).toBe("unusual-name");
  });
});
