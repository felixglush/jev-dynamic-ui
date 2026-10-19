import { describe, expect, it } from "vitest";

import type { ClassifyResult, ParamValue } from "@/lib/jev/types";
import { settle } from "./settle";

const v = (value: string | null): ParamValue => ({ value, confidence: value ? 0.9 : null });
const send = (recipient: string | null, amount: string | null): ClassifyResult =>
  ({
    action: "send_etransfer",
    confidence: 0.9,
    params: { recipient: v(recipient), recipient_email: v(null), amount: v(amount), from_account: v(null), date: v(null), frequency: v(null) },
    missing: [recipient ? null : "recipient", amount ? null : "amount"].filter(Boolean),
  }) as ClassifyResult;
const values = (result: ClassifyResult) => {
  const params = (result.action === null ? {} : result.params) as Record<string, ParamValue>;
  return { recipient: params.recipient?.value, amount: params.amount?.value };
};

describe("settle", () => {
  it("shows the first answer as it is, and a different action at once", () => {
    const first = send("sam", "50");
    expect(settle(null, null, first)).toBe(first);
    const other: ClassifyResult = { action: null, confidence: 0.2 };
    expect(settle(first, first, other)).toBe(other);
  });

  it("fills a blank field at once", () => {
    const result = settle(send("sam", null), send("sam", null), send("sam", "50"));
    expect(values(result)).toEqual({ recipient: "sam", amount: "50" });
    expect(result.action === null ? [] : result.missing).toEqual([]);
  });

  it("keeps a filled field until two answers in a row agree on the new value", () => {
    const shown = send("sam", "50");
    const once = settle(shown, shown, send("sam", "15"));
    expect(values(once)).toEqual({ recipient: "sam", amount: "50" });
    const twice = settle(once, send("sam", "15"), send("sam", "15"));
    expect(values(twice)).toEqual({ recipient: "sam", amount: "15" });
  });

  it("never clears a filled field because two answers in a row leave it out", () => {
    const shown = send("sam", "50");
    const once = settle(shown, shown, send("sam", null));
    const twice = settle(once, send("sam", null), send("sam", null));
    expect(values(twice).amount).toBe("50");
  });

  it("does not report a held field as missing", () => {
    const shown = send("sam", "50");
    const result = settle(shown, shown, send("sam", null));
    expect(values(result).amount).toBe("50");
    expect(result.action === null ? [] : result.missing).toEqual([]);
  });
});
