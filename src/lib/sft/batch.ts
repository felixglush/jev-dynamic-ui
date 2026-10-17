/**
 * Read a batch of labeled messages (the text format `npm run sft:add` takes) into typed examples and
 * check their structure. Whether a value is really in the message is a labeling rule
 * (docs/sft-dataset.md), checked by the person who reviews the rows on /annotate.
 *
 * File format, one example per line:  `message => field=value; field=value`
 * Only the fields the message states are listed. Everything else is blank in the training target.
 */
import { CATALOG, type ParamSpec } from "@/lib/jev/catalog";
import { isKind, type Kind } from "./kinds";
import type { Split } from "./split";
import { freeTextParams } from "@/lib/extract/prompt";

export type Action = keyof typeof CATALOG;

export type LabeledExample = {
  /** Position in the batch (`batch-NNN`); the examples file assigns the real ids. */
  id: string;
  action: Action;
  message: string;
  /** Only the fields the message states; absent fields are simply missing here. */
  fields: Record<string, string | number>;
  /** The `# <action> (vague)` groups: messages that don't say enough, so most fields are blank. */
  vague: boolean;
  /** From a `# pattern: name` line above it; see ExampleRecord in examples.ts. */
  pattern?: string;
  /** From a `# kind: x` line above it (see kinds.ts); a guess is made when absent. */
  kind?: Kind;
  /** From a `# split: train|val|test` line above it. */
  split?: Split;
};

const isAction = (name: string): name is Action => Object.hasOwn(CATALOG, name);

export function parseBatch(text: string): LabeledExample[] {
  const examples: LabeledExample[] = [];
  let action: Action | null = null;
  let vague = false;
  let pattern: string | undefined;
  let split: Split | undefined;
  let kind: Kind | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      // `# pattern: x` and `# split: x` tag the rows below them until changed (empty clears); a header
      // names an action; any other `#` line is a comment.
      const tag = /^#\s*(pattern|split|kind):\s*(.*)$/.exec(line);
      if (tag) {
        const value = (tag[2] ?? "").trim();
        if (tag[1] === "pattern") pattern = value || undefined;
        else if (tag[1] === "kind") {
          if (value && !isKind(value)) throw new Error(`Bad kind "${value}": ${line}`);
          kind = (value || undefined) as Kind | undefined;
        }
        else if (!value) split = undefined;
        else if (value === "train" || value === "val" || value === "test") split = value;
        else throw new Error(`Bad split "${value}" (train, val or test): ${line}`);
        continue;
      }
      const name = line.replace(/^#\s*/, "").replace(/\s*\(vague\)$/, "");
      if (isAction(name)) {
        action = name;
        vague = line.endsWith("(vague)");
      }
      continue;
    }
    if (!action) throw new Error(`Example before any action header: ${line}`);
    // `message => labels`, or just `message =>` when no field is stated.
    const [, message = "", labels = ""] = /^(.*?)(?: =>(?: (.*))?)?$/.exec(line) ?? [];
    const fields: Record<string, string | number> = {};
    for (const pair of labels.split("; ").filter(Boolean)) {
      const at = pair.indexOf("=");
      if (at < 0) throw new Error(`Bad label "${pair}" in: ${line}`);
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      const spec = (CATALOG[action].params as Record<string, ParamSpec>)[name];
      fields[name] = spec?.type === "amount" ? Number(value) : value;
    }
    examples.push({ id: `batch-${String(examples.length + 1).padStart(3, "0")}`, action, message, fields, vague, ...(pattern ? { pattern } : {}), ...(kind ? { kind } : {}), ...(split ? { split } : {}) });
  }
  return examples;
}

/** Everything wrong with the labels, as readable strings. Empty means the set is clean. */
export function validateBatch(examples: LabeledExample[]): string[] {
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
      } else if (spec.type === "amount" ? !(typeof value === "number" && Number.isFinite(value) && value > 0) : typeof value !== "string" || !value.trim()) {
        problems.push(`${where}: "${name}" has no usable value (${JSON.stringify(value)}); leave a blank field out instead`);
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
