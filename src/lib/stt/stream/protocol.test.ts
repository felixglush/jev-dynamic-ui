import { describe, expect, it } from "vitest";
import { parseServerMessage } from "./protocol";

describe("parseServerMessage", () => {
  it("reads the server messages", () => {
    expect(parseServerMessage('{"type":"partial","text":"send fifty"}')).toEqual({ type: "partial", text: "send fifty" });
    expect(parseServerMessage('{"type":"final","text":"send fifty dollars"}')).toEqual({ type: "final", text: "send fifty dollars" });
    expect(parseServerMessage('{"type":"endpoint"}')).toEqual({ type: "endpoint" });
    expect(parseServerMessage('{"type":"error","message":"boom"}')).toEqual({ type: "error", message: "boom" });
  });

  it("ignores anything else instead of throwing", () => {
    for (const bad of [new ArrayBuffer(4), "not json", "null", "[]", '{"type":"partial"}', '{"type":"nope","text":"x"}']) {
      expect(parseServerMessage(bad)).toBeNull();
    }
  });
});
