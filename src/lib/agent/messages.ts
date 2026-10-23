/**
 * The shape of the agent chat, and a sample conversation to render until the agent is connected.
 *
 * An agent message can carry proposals: fixes the customer can take. Each proposal is an ActionCall from the
 * catalog, so it opens the same prefilled form the banking demo uses and nothing moves until it is submitted.
 */
import type { ActionCall } from "@/lib/jev/types";

export type Proposal = {
  id: string;
  /** What the fix is, in a few words. */
  label: string;
  /** What it does to the goal, so the options can be compared. */
  effect: string;
  call: ActionCall;
};

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "agent"; text: string; proposals?: Proposal[] };

/** A monthly transfer from chequing to savings, prefilled the way Jev would hand it to the form. */
function monthlySavingsTransfer(amount: string): ActionCall {
  const sure = (value: string | null) => ({ value, confidence: 1 });
  return {
    action: "transfer_between_accounts",
    confidence: 1,
    params: {
      from_account: sure("chequing"),
      to_account: sure("savings"),
      amount: sure(amount),
      date: sure(null),
      frequency: sure("monthly"),
    },
    missing: [],
  };
}

/** The roof example from the scoping doc: a goal drifts and the agent offers three fixes. */
export const SAMPLE_THREAD: ChatMessage[] = [
  { id: "m1", role: "user", text: "I need about $15k for a new roof by next June. I've got $6k put away." },
  {
    id: "m2",
    role: "agent",
    text: "Got it: $15,000 by June 30, 2027, with $6,000 saved. That's $1,125 a month. I'll check it on the 1st of each month and only message you if it drifts.",
  },
  {
    id: "m3",
    role: "agent",
    text: "Your roof fund is behind. You've put in $700 a month since November, so you'd reach $11,600 by June, $3,400 short. Here are three ways to close the gap:",
    proposals: [
      {
        id: "p1",
        label: "Raise to $1,125 a month",
        effect: "Keeps the June date.",
        call: monthlySavingsTransfer("1125"),
      },
      {
        id: "p2",
        label: "Keep $700 a month",
        effect: "Moves the date to November 2027.",
        call: monthlySavingsTransfer("700"),
      },
      {
        id: "p3",
        label: "Raise to $900 a month",
        effect: "Moves the date to August 2027.",
        call: monthlySavingsTransfer("900"),
      },
    ],
  },
];

/** What the agent says to anything typed, until it is connected. */
export const NOT_CONNECTED_REPLY = "I'm not connected yet, so I can't answer that. This page is a preview of the chat.";
