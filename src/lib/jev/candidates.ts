/**
 * Find candidate values in the text with code. Jev then picks which candidate fills each parameter.
 *
 * Jev chooses; it never writes text. So these finders deliberately over-find: they only need the
 * right value to be somewhere in the list.
 */
import type { ParamSpec } from "./catalog";

// Choice questions allow at most 255 options; stay under that.
const MAX_OPTIONS = 250;
const MAX_NAME_WORDS = 3;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\(?\+?\d[\d\s()\-.]{6,}\d/g;
const MONEY_RE = /\$?\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:k|dollars?|bucks|cad))?/gi;
const ORDINAL_RE = /\b\d{1,2}(?:st|nd|rd|th)\b/gi;
// \p{L} is any letter in any script and \p{M} a combining mark, so accented and non-Latin names stay whole.
const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}'’\-]*/gu;

// A name candidate shouldn't start or end with filler. "my" may start one ("my sister").
const EDGE_WORDS = new Set(
  (
    "a an the to for from and or of on in at with by please i me it its is so can could you your " +
    "that this send sent pay paying add open set up money account transfer etransfer e-transfer " +
    "e transfer contact card credit want need would like how do what whats when " +
    "bill payee biller autopay autodeposit lock unlock replace dispute charge transaction transactions " +
    "balance recent show check view cancel request every each monthly weekly biweekly"
  ).split(" "),
);

function dedupe(spans: string[]): string[] {
  // A Set keeps insertion order, so the first occurrence wins and document order is preserved.
  const unique = new Set(spans.map((s) => s.trim().replace(/^[ ,.]+|[ ,.]+$/g, "")).filter(Boolean));
  return [...unique].slice(0, MAX_OPTIONS);
}

export function findEmails(text: string): string[] {
  return dedupe(text.match(EMAIL_RE) ?? []);
}

export function findPhones(text: string): string[] {
  const phones = (text.match(PHONE_RE) ?? []).filter((p) => p.replace(/\D/g, "").length >= 7);
  return dedupe(phones);
}

export function findAmounts(text: string): string[] {
  // Blank out emails, phone numbers and day ordinals ("the 1st") first so their digits aren't read as money.
  const withoutContacts = text.replace(EMAIL_RE, " ").replace(PHONE_RE, " ").replace(ORDINAL_RE, " ");
  return dedupe(withoutContacts.match(MONEY_RE) ?? []);
}

export function findNames(text: string): string[] {
  const words = (text.replace(EMAIL_RE, " ").match(WORD_RE) ?? []).filter(Boolean);
  const spans: string[] = [];
  for (let size = 1; size <= MAX_NAME_WORDS; size++) {
    for (let start = 0; start + size <= words.length; start++) {
      const span = words.slice(start, start + size);
      const first = (span[0] ?? "").toLowerCase();
      const last = (span[span.length - 1] ?? "").toLowerCase();
      if (EDGE_WORDS.has(last) || (first !== "my" && EDGE_WORDS.has(first))) continue;
      spans.push(span.join(" "));
    }
  }
  return dedupe(spans);
}

// Biller account numbers: 5 to 20 digits, often written with spaces or dashes.
const ACCOUNT_NUMBER_RE = /\d(?:[\d\- ]{3,22})\d/g;

export function findAccountNumbers(text: string): string[] {
  const numbers = (text.replace(EMAIL_RE, " ").match(ACCOUNT_NUMBER_RE) ?? []).filter((n) => {
    const digits = n.replace(/\D/g, "").length;
    return digits >= 5 && digits <= 20;
  });
  return dedupe(numbers);
}

// --- Dates -------------------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_PATTERN = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY_PATTERN = "\\d{1,2}(?:st|nd|rd|th)?";
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b${MONTH_PATTERN}\\.? ${DAY_PATTERN}(?:,? \\d{4})?\\b`, "gi"),
  new RegExp(`\\b${DAY_PATTERN} (?:of )?${MONTH_PATTERN}\\b(?:,? \\d{4})?`, "gi"),
  /\b(?:today|tomorrow|tonight)\b/gi,
  /\b(?:(?:next|this|on) )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
  /\bthe \d{1,2}(?:st|nd|rd|th)\b/gi,
];

/** A calendar day as year/month(0-11)/day, built without time zones so adding days never slips. */
const toIso = (utc: Date) => utc.toISOString().slice(0, 10);
const utcDay = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day));

/**
 * Turn a date phrase into YYYY-MM-DD, relative to `now` (the customer's "today"), or null when the
 * phrase isn't a real date. A phrase without a year means the next time that day comes around.
 */
export function parseDate(span: string, now: Date): string | null {
  const text = span.toLowerCase().replace(/[,.]/g, "").replace(/\s+/g, " ").trim();
  const today = utcDay(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (days: number) => toIso(utcDay(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
  const isReal = (y: number, m: number, d: number) => {
    const date = utcDay(y, m, d);
    return date.getUTCMonth() === m && date.getUTCDate() === d;
  };
  /** The first day on or after today that falls on month/day, in this year or the next. */
  const upcoming = (month: number, day: number) => {
    for (const year of [today.getUTCFullYear(), today.getUTCFullYear() + 1, today.getUTCFullYear() + 2]) {
      if (isReal(year, month, day) && utcDay(year, month, day) >= today) return toIso(utcDay(year, month, day));
    }
    return null;
  };

  if (text === "today" || text === "tonight") return addDays(0);
  if (text === "tomorrow") return addDays(1);

  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
    return isReal(y, m, d) ? toIso(utcDay(y, m, d)) : null;
  }

  const weekday = WEEKDAYS.findIndex((name) => text.endsWith(name));
  if (weekday !== -1) {
    // Always a future day: "friday" said on a Friday means next week's.
    const ahead = ((weekday - today.getUTCDay() + 6) % 7) + 1;
    return addDays(ahead);
  }

  match = /^the (\d{1,2})(?:st|nd|rd|th)$/.exec(text);
  if (match) {
    const day = Number(match[1]);
    for (let offset = 0; offset < 14; offset++) {
      const candidate = utcDay(today.getUTCFullYear(), today.getUTCMonth() + offset, day);
      if (candidate.getUTCDate() === day && candidate >= today) return toIso(candidate);
    }
    return null;
  }

  const monthFirst = new RegExp(`^(${MONTH_PATTERN}) (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?$`).exec(text);
  const dayFirst = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTH_PATTERN})(?: (\\d{4}))?$`).exec(text);
  const named = monthFirst ? { m: monthFirst[1], d: monthFirst[2], y: monthFirst[3] } : dayFirst ? { m: dayFirst[2], d: dayFirst[1], y: dayFirst[3] } : null;
  if (named?.m && named.d) {
    const month = MONTHS.indexOf(named.m.slice(0, 3));
    const day = Number(named.d);
    if (named.y) return isReal(Number(named.y), month, day) ? toIso(utcDay(Number(named.y), month, day)) : null;
    return upcoming(month, day);
  }
  return null;
}

export function findDates(text: string, now: Date = new Date()): string[] {
  const spans = DATE_PATTERNS.flatMap((pattern) => text.match(pattern) ?? []);
  // Keep only phrases that really are dates ("February 30" is not), in the order they appear.
  const valid = spans.filter((span) => parseDate(span, now) !== null);
  return dedupe(valid.sort((a, b) => text.toLowerCase().indexOf(a.toLowerCase()) - text.toLowerCase().indexOf(b.toLowerCase())));
}

/** Candidate finders for the parameter types that are read out of the query text. */
export const FINDERS: Record<Exclude<ParamSpec["type"], "choice">, (text: string, now: Date) => string[]> = {
  name: findNames,
  email: findEmails,
  phone: findPhones,
  amount: findAmounts,
  date: findDates,
  account_number: findAccountNumbers,
};

/** Turn the span Jev picked into a clean value the UI can use. */
export function normalize(type: ParamSpec["type"], span: string, now: Date = new Date()): string {
  switch (type) {
    case "date":
      return parseDate(span, now) ?? span;
    case "account_number":
      return span.replace(/\D/g, "");
    case "email":
      return span.toLowerCase();
    case "phone":
      return span.replace(/[^\d+]/g, "");
    case "amount": {
      const thousands = /k\s*$/i.test(span);
      const digits = Number(span.replace(/[^\d.]/g, ""));
      if (Number.isNaN(digits)) return span;
      return (thousands ? digits * 1000 : digits).toFixed(2);
    }
    default:
      return span;
  }
}
