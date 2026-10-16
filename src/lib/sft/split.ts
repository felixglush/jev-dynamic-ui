/**
 * Which split a reviewed sample row belongs to, decided from its id alone.
 *
 * A hash of the id (not a position in a sorted list) means a row's split never changes when other
 * rows are approved, rejected or added, so val and test stay the same messages from run to run.
 * The salt was picked so that, with every sample row approved, each action has at least one val
 * and one test row. Change it only on purpose: it reshuffles the held-out sets.
 */
import { createHash } from "node:crypto";

export type Split = "train" | "val" | "test";

export const SPLIT_SALT = "v3";
/** Share of sample rows held out, in percent. */
export const TEST_PERCENT = 15;
export const VAL_PERCENT = 15;

export function splitOf(id: string): Split {
  const bucket = parseInt(createHash("sha256").update(`${SPLIT_SALT}:${id}`).digest("hex").slice(0, 8), 16) % 100;
  return bucket < TEST_PERCENT ? "test" : bucket < TEST_PERCENT + VAL_PERCENT ? "val" : "train";
}
