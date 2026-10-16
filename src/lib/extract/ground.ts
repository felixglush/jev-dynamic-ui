/**
 * Grounding: a small model will happily invent a name, email or date, so every value it returns is
 * checked against the customer's message. A value that doesn't literally appear there (after
 * normalizing) is dropped and the field is left blank for the customer to fill in.
 */
import { findAmounts } from "@/lib/jev/candidates";

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/** Every amount the message could be saying: "1,850" and "$1.5k" as digits, "seventy-five" as words. */
export function amountsIn(message: string): Set<number> {
  const found = new Set<number>();
  // findAmounts already ignores digits that belong to emails, phone numbers and day ordinals ("the 15th").
  for (const span of findAmounts(message)) {
    const value = Number(span.replace(/[^\d.]/g, ""));
    if (Number.isFinite(value) && /\d/.test(span)) found.add(/\d\s?k\b/i.test(span) ? value * 1000 : value);
  }
  // Spelled out: "two hundred", "seventy-five", "one thousand five hundred". Each run of number
  // words is its own phrase, so "fifty dollars ... in two weeks" gives 50 and 2, not 52.
  let total = 0;
  let current = 0;
  let inPhrase = false;
  const endPhrase = () => {
    if (inPhrase) found.add(total + current);
    total = 0;
    current = 0;
    inPhrase = false;
  };
  for (const word of message.toLowerCase().replaceAll("-", " ").match(/[a-z]+|[^a-z\s]+/g) ?? []) {
    const small = NUMBER_WORDS[word];
    if (small !== undefined) {
      current += small;
      inPhrase = true;
    } else if (word === "hundred" && inPhrase) {
      current = (current || 1) * 100;
    } else if (word === "thousand" && inPhrase) {
      total += (current || 1) * 1000;
      current = 0;
    } else if (word !== "and") {
      endPhrase();
    }
  }
  endPhrase();
  return found;
}

const fold = (text: string) => text.normalize("NFC").toLowerCase();
const digitsOf = (text: string) => text.replace(/\D/g, "");

/** True when `value` is really stated in `message`. Amounts are numbers; everything else is text. */
export function isGrounded(type: string, value: string | number, message: string): boolean {
  if (type === "amount") return typeof value === "number" && value > 0 && amountsIn(message).has(value);
  const text = String(value).trim();
  if (!text) return false;
  if (type === "phone") return digitsOf(text).length >= 7 && digitsOf(message).includes(digitsOf(text));
  return fold(message).includes(fold(text));
}
