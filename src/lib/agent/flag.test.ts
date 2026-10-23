import { describe, expect, it } from "vitest";

import { agentEnabled } from "./flag";

describe("agentEnabled", () => {
  it("is on only for the literal true", () => {
    expect(agentEnabled({ AGENT_ENABLED: "true" })).toBe(true);
    expect(agentEnabled({})).toBe(false);
    expect(agentEnabled({ AGENT_ENABLED: "" })).toBe(false);
    expect(agentEnabled({ AGENT_ENABLED: "1" })).toBe(false);
    expect(agentEnabled({ AGENT_ENABLED: "false" })).toBe(false);
  });
});
