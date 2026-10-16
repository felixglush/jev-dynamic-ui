/**
 * Read the hand-labeled seed file (data/sft/seed-labeled.txt) into typed examples and check every
 * label against the same rules the extractor enforces at run time.
 *
 * File format, one example per line:  `message => field=value; field=value`
 * Only the fields the message states are listed. Everything else is blank in the training target.
 */
import { CATALOG, type ParamSpec } from "@/lib/jev/catalog";
import { freeTextParams } from "@/lib/extract/ollama";
import { isGrounded } from "@/lib/extract/ground";

export type Action = keyof typeof CATALOG;

export type LabeledExample = {
  /** Stable id: `seed-NNN` by line order. Never reused, so append new lines at the end of a group. */
  id: string;
  action: Action;
  message: string;
  /** Only the fields the message states; absent fields are simply missing here. */
  fields: Record<string, string | number>;
  /** The `# <action> (vague)` groups: messages that don't say enough, so most fields are blank. */
  vague: boolean;
};

const isAction = (name: string): name is Action => name in CATALOG;

export function parseSeed(text: string): LabeledExample[] {
  const examples: LabeledExample[] = [];
  let action: Action | null = null;
  let vague = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      // A header names an action; any other `#` line is a comment.
      const name = line.replace(/^#\s*/, "").replace(/\s*\(vague\)$/, "");
      if (isAction(name)) {
        action = name;
        vague = line.endsWith("(vague)");
      }
      continue;
    }
    if (!action) throw new Error(`Example before any action header: ${line}`);
    const [message = "", labels = ""] = line.split(" => ");
    const fields: Record<string, string | number> = {};
    for (const pair of labels.split("; ").filter(Boolean)) {
      const at = pair.indexOf("=");
      if (at < 0) throw new Error(`Bad label "${pair}" in: ${line}`);
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      const spec = (CATALOG[action].params as Record<string, ParamSpec>)[name];
      fields[name] = spec?.type === "amount" ? Number(value) : value;
    }
    examples.push({ id: `seed-${String(examples.length + 1).padStart(3, "0")}`, action, message, fields, vague });
  }
  return examples;
}

/** Everything wrong with the labels, as readable strings. Empty means the set is clean. */
export function validateExamples(examples: LabeledExample[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const example of examples) {
    const where = `${example.id} (${example.action}) "${example.message}"`;
    const params = Object.fromEntries(freeTextParams(example.action));
    if (Object.keys(params).length === 0) problems.push(`${where}: action has no free-text fields to train on`);

    for (const [name, value] of Object.entries(example.fields)) {
      const spec = params[name];
      if (!spec) {
        problems.push(`${where}: "${name}" is not a free-text field of ${example.action}`);
      } else if (typeof value === "number" && !Number.isFinite(value)) {
        problems.push(`${where}: "${name}" is not a number`);
      } else if (!isGrounded(spec.type, value, example.message)) {
        problems.push(`${where}: ${name}=${JSON.stringify(value)} is not stated in the message`);
      }
    }

    // The same message under the same action twice would leak between train and test.
    const key = `${example.action}|${example.message.normalize("NFC").toLowerCase().replace(/\s+/g, " ")}`;
    const first = seen.get(key);
    if (first) problems.push(`${where}: duplicate of ${first}`);
    else seen.set(key, example.id);
  }
  return problems;
}
