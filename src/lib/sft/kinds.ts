/**
 * The kind of example a training row is: what makes the message interesting (a typo, an accented
 * name, a worded number...), not which banking action it is. One kind per row, in `meta.kind`.
 *
 * `meta.pattern` is different: it names the failure pattern an evaluation row probes and feeds the
 * per-pattern pass rates, so it stays frozen. `kind` is free to change while you review.
 */
export const KINDS = [
  { id: "typo", label: "Typo or slang" },
  { id: "accented-name", label: "Accented name" },
  { id: "unusual-name", label: "Unusual name (lowercase, company, odd shape)" },
  { id: "worded-number", label: "Worded number (\"two grand\")" },
  { id: "amount-format", label: "Amount format (separators, symbols)" },
  { id: "date", label: "Date (relative, edge, format)" },
  { id: "multiple-numbers", label: "Multiple numbers or people" },
  { id: "distractor", label: "Distractor (negation, correction, injection)" },
  { id: "contact-details", label: "Email or phone" },
  { id: "missing-info", label: "Missing or vague info" },
  { id: "plain", label: "Plain" },
] as const;

export type Kind = (typeof KINDS)[number]["id"];

export const isKind = (value: unknown): value is Kind => KINDS.some((k) => k.id === value);
export const kindLabel = (id: string) => KINDS.find((k) => k.id === id)?.label ?? id;

/** Existing failure patterns, mapped to the kind they belong to. */
const PATTERN_KIND: Record<string, Kind> = {
  "typos-slang": "typo",
  "typo-field": "typo",
  "accented-name": "accented-name",
  "odd-name": "unusual-name",
  "name-shape": "unusual-name",
  "lowercase-name": "unusual-name",
  "company-name": "unusual-name",
  "spelled-amount": "worded-number",
  "worded-number": "worded-number",
  "amount-separators": "amount-format",
  "amount-format": "amount-format",
  "date-edge": "date",
  "date-format": "date",
  "today-date": "date",
  "past-event-date": "date",
  "two-amounts": "multiple-numbers",
  "multi-entity": "multiple-numbers",
  "phone-ext": "multiple-numbers",
  negation: "distractor",
  "self-correction": "distractor",
  injection: "distractor",
  "junk-input": "distractor",
  "email-no-name": "contact-details",
  "email-shape": "contact-details",
  "cancel-email-only": "contact-details",
  "phone-no-email": "contact-details",
  "phone-account": "contact-details",
  "placeholder-empty": "missing-info",
  "vague-empty": "missing-info",
  "amount-not-stated": "missing-info",
  "relationship-blank": "missing-info",
  plain: "plain",
};

const NUMBER_WORDS = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand|bucks?|k)\b|\b\d+(?:\.\d+)?\s?k\b/i;
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_WORDS = new RegExp(
  String.raw`\b(?:today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month|(?:${MONTHS})\.?\s+\d+|may\s+\d+|\d{1,2}(?:st|nd|rd|th)|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b`,
  "i",
);

/**
 * A starting guess for a row with no kind: a pattern's kind if it has one, otherwise a few plain
 * rules on the message. Only a suggestion; a reviewer can change it.
 */
export function guessKind(message: string, answer: Record<string, string>, pattern?: string): Kind {
  if (pattern && PATTERN_KIND[pattern]) return PATTERN_KIND[pattern]!;
  if (/[^\u0000-\u007f]/.test(message) && /\p{L}/u.test(message.replace(/[\u0000-\u007f]/g, ""))) return "accented-name";
  if (NUMBER_WORDS.test(message)) return "worded-number";
  // Count numbers once dates and phone numbers are set aside, so "$100 on December 24" is a date, not two amounts.
  const numbers = message.replace(DATE_WORDS, " ").replace(/\+?\d[\d ().-]{8,}\d/g, " ").match(/\d[\d,.]*/g) ?? [];
  if (numbers.length >= 2) return "multiple-numbers";
  if (DATE_WORDS.test(message)) return "date";
  if (/@/.test(message) || /\b\d{3}[ -.]?\d{3}[ -.]?\d{4}\b/.test(message)) return "contact-details";
  if (Object.keys(answer).length === 0) return "missing-info";
  return "plain";
}
