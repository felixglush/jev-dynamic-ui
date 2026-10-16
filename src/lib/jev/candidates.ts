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
const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

// A name candidate shouldn't start or end with filler. "my" may start one ("my sister").
const EDGE_WORDS = new Set(
  (
    "a an the to for from and or of on in at with by please i me it its is so can could you your " +
    "that this send sent pay paying add open set up money account transfer etransfer e-transfer " +
    "e transfer contact card credit want need would like how do what whats when"
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
  // Blank out emails and phone numbers first so their digits aren't read as money.
  const withoutContacts = text.replace(EMAIL_RE, " ").replace(PHONE_RE, " ");
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

/** Candidate finders for the parameter types that are read out of the query text. */
export const FINDERS: Record<Exclude<ParamSpec["type"], "choice">, (text: string) => string[]> = {
  name: findNames,
  email: findEmails,
  phone: findPhones,
  amount: findAmounts,
};

/** Turn the span Jev picked into a clean value the UI can use. */
export function normalize(type: ParamSpec["type"], span: string): string {
  switch (type) {
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
