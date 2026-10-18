/**
 * Turns what a speech engine writes for spoken words into how people type them, before the text reaches Jev and the
 * extractor: "send fifty dollars to sam" -> "send 50 dollars to sam", "alex at acme dot com" -> "alex@acme.com".
 * English only. Engines that already write digits and symbols (Whisper) pass through almost unchanged; engines that
 * write everything as words in capitals (the streaming Zipformer) need it.
 *
 * It only rewrites patterns that are safe to read one way. Anything ambiguous ("one" meaning the pronoun, "first" in
 * "my first account") is left alone.
 */

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const TLDS = new Set(["com", "ca", "org", "net", "edu", "io", "co", "gov", "info"]);
const ORDINAL_UNITS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11,
  twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
  twentieth: 20, thirtieth: 30,
};

const MONEY_WORDS = new Set(["dollar", "dollars", "buck", "bucks", "grand", "k", "cad", "cents"]);

const unitValue = (word: string) => UNITS.indexOf(word);
const teenValue = (word: string) => (TEENS.includes(word) ? 10 + TEENS.indexOf(word) : -1);
const tensValue = (word: string) => (word.length > 3 && TENS.includes(word) ? TENS.indexOf(word) * 10 : -1);

export function normalizeSpoken(text: string): string {
  // An engine that writes only capitals has nothing to preserve, so lowercase it. Mixed case is left as written.
  const base = /[a-z]/.test(text) ? text : text.toLowerCase();
  // Words only matter, so work on tokens; punctuation stays attached to its token and is skipped by the matchers.
  let tokens = base.split(/\s+/).filter(Boolean);
  tokens = joinEmails(tokens);
  tokens = joinDigitRuns(tokens);
  tokens = convertDates(tokens);
  tokens = convertNumbers(tokens);
  return tokens.join(" ");
}

const word = (token: string | undefined) => (token ?? "").toLowerCase().replace(/[^a-z0-9']/g, "");

/** "priya dot k at example dot com" -> "priya.k@example.com" */
function joinEmails(tokens: string[]): string[] {
  const out = [...tokens];
  for (let at = 1; at < out.length - 2; at++) {
    if (word(out[at]) !== "at" || !/^[a-z0-9]+$/.test(word(out[at + 1]))) continue;
    // The domain: word (dot word)+ ending in a known ending, e.g. example dot com.
    let end = at + 1;
    const domain = [word(out[end])];
    while (word(out[end + 1]) === "dot" && /^[a-z0-9]+$/.test(word(out[end + 2]))) {
      domain.push(word(out[end + 2]));
      end += 2;
    }
    if (domain.length < 2 || !TLDS.has(domain.at(-1)!)) continue;
    // The name: the word before "at", plus more words joined by dot / underscore / dash.
    let start = at - 1;
    const local = [word(out[start])];
    while (start >= 2 && ["dot", "underscore", "dash", "hyphen"].includes(word(out[start - 1])) && /^[a-z0-9]+$/.test(word(out[start - 2]))) {
      local.unshift(word(out[start - 2]), { dot: ".", underscore: "_", dash: "-", hyphen: "-" }[word(out[start - 1])]!);
      start -= 2;
    }
    if (!/^[a-z0-9]+$/.test(local.at(-1)!)) continue;
    out.splice(start, end - start + 1, `${local.join("")}@${domain.join(".")}`);
    at = start;
  }
  return out;
}

/** "four one six five five five zero one nine nine" -> "416-555-0199"; shorter runs (account numbers) are joined plainly. */
function joinDigitRuns(tokens: string[]): string[] {
  const isDigitWord = (token: string | undefined) => (word(token) === "oh" ? true : unitValue(word(token)) >= 0);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    let end = i;
    while (end < tokens.length && isDigitWord(tokens[end])) end++;
    const run = tokens.slice(i, end).map((token) => (word(token) === "oh" ? 0 : unitValue(word(token))));
    // "oh" alone is an exclamation and "one" a pronoun: only a run of four or more digit words is a number.
    if (run.length >= 4) {
      const digits = run.join("");
      out.push(digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits);
      i = end;
    } else {
      out.push(tokens[i]!);
      i++;
    }
  }
  return out;
}

/** "march fourth" -> "march 4th", "the fifth of november" -> "the 5th of november" */
function convertDates(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const ordinal = readOrdinal(tokens, i);
    const afterMonth = out.length > 0 && MONTHS.includes(word(out.at(-1)));
    const beforeMonth = ordinal && word(tokens[i + ordinal.length]) === "of" && MONTHS.includes(word(tokens[i + ordinal.length + 1]));
    if (ordinal && (afterMonth || beforeMonth)) {
      out.push(`${ordinal.value}${suffix(ordinal.value)}`);
      i += ordinal.length - 1;
    } else out.push(tokens[i]!);
  }
  return out;
}

function readOrdinal(tokens: string[], i: number): { value: number; length: number } | null {
  const first = word(tokens[i]);
  if (first in ORDINAL_UNITS) return { value: ORDINAL_UNITS[first]!, length: 1 };
  // "twenty first" .. "thirty first"
  const tens = tensValue(first);
  const unit = ORDINAL_UNITS[word(tokens[i + 1])];
  if ((tens === 20 || tens === 30) && unit !== undefined && unit >= 1 && unit <= 9) return { value: tens + unit, length: 2 };
  return null;
}

const suffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th"));

/** "two hundred and fifty" -> "250"; "eleven ninety nine" -> "11.99" */
function convertNumbers(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const number = readNumber(tokens, i);
    if (!number) {
      out.push(tokens[i]!);
      i++;
      continue;
    }
    // Prices said as dollars and cents without the words: "eleven ninety nine" (11.99), "nine fifty" (9.50).
    const next = readNumber(tokens, i + number.length);
    if (next && number.value >= 1 && number.value <= 99 && next.value >= 10 && next.value <= 99 && isTensWord(tokens[i + number.length])) {
      out.push(`${number.value}.${String(next.value).padStart(2, "0")}`);
      i += number.length + next.length;
      continue;
    }
    // A lone digit word ("one of my accounts", "best five") is rarely an amount unless money follows it.
    if (number.length === 1 && number.value < 10 && !MONEY_WORDS.has(word(tokens[i + 1]))) {
      out.push(tokens[i]!);
      i++;
      continue;
    }
    out.push(String(number.value));
    i += number.length;
  }
  return out;
}

const isTensWord = (token: string | undefined) => tensValue(word(token)) >= 0 || teenValue(word(token)) >= 0;

/** The longest valid number written in words starting at `i`, or null. */
function readNumber(tokens: string[], i: number): { value: number; length: number } | null {
  let total = 0;
  let group = 0; // the part below a thousand being built
  let length = 0;
  let valid = 0; // tokens consumed by a complete number
  let validValue = 0;
  let state: "start" | "tens" | "unit" | "hundred" | "scale" | "and" = "start";
  for (let j = i; j < tokens.length; j++) {
    const w = word(tokens[j]);
    const unit = unitValue(w);
    const teen = teenValue(w);
    const tens = tensValue(w);
    const groupStart = state === "start" || state === "hundred" || state === "scale" || state === "and";
    if (w === "and" && (state === "hundred" || state === "scale")) state = "and";
    else if (tens >= 0 && groupStart) {
      group += tens;
      state = "tens";
    } else if (teen >= 0 && groupStart) {
      group += teen;
      state = "unit";
    } else if (unit >= 1 && (groupStart || state === "tens")) {
      group += unit;
      state = "unit";
    } else if (w === "hundred" && state === "unit" && group >= 1 && group <= 9) {
      group *= 100;
      state = "hundred";
    } else if ((w === "thousand" || w === "million") && (state === "unit" || state === "tens" || state === "hundred")) {
      total += (group || 1) * (w === "thousand" ? 1000 : 1_000_000);
      group = 0;
      state = "scale";
    } else break;
    length = j - i + 1;
    if (state !== "and") {
      valid = length;
      validValue = total + group;
    }
  }
  return valid > 0 ? { value: validValue, length: valid } : null;
}
