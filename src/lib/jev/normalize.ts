/**
 * Clean up the free-text values the extractor reads from the message so the forms can use them
 * (dates to YYYY-MM-DD, phones to digits, amounts to two decimals).
 */
import type { ParamSpec } from "./catalog";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_PATTERN = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

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
    // Eight years ahead always reaches the next leap day, even across a skipped leap year like 2100.
    for (let year = today.getUTCFullYear(); year <= today.getUTCFullYear() + 8; year++) {
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

/** Turn a value the extractor read from the message into a clean value the UI can use. */
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
