/**
 * The proactive finance agent is built behind AGENT_ENABLED so the banking demo at / stays exactly as it is.
 * Only the literal "true" turns it on; anything else (unset, "1", "on") leaves /agent a 404.
 */
export function agentEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AGENT_ENABLED === "true";
}
