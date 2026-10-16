/**
 * Grounding: a small model will happily invent a name, email or date, so every value it returns is
 * checked against the customer's message. A value that doesn't literally appear there (after
 * normalizing) is dropped and the field is left blank for the customer to fill in.
 */

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/** Every amount the message could be saying: "1,850" and "$1.5k" as digits, "seventy-five" as words. */
export function amountsIn(message: string): Set<number> {
  const found = new Set<number>();
  const text = message.toLowerCase();
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?(\s?k\b)?/g)) {
    const value = Number(match[0].replace(/[,k\s]/g, ""));
    if (Number.isFinite(value)) found.add(match[1] ? value * 1000 : value);
  }
  // Spelled out: "two hundred", "seventy-five", "one thousand five hundred".
  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (const word of text.replaceAll("-", " ").match(/[a-z]+/g) ?? []) {
    const small = NUMBER_WORDS[word];
    if (small !== undefined) {
      current += small;
      sawNumber = true;
    } else if (word === "hundred" && sawNumber) {
      current = (current || 1) * 100;
    } else if (word === "thousand" && sawNumber) {
      total += (current || 1) * 1000;
      current = 0;
    }
  }
  if (sawNumber) found.add(total + current);
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
