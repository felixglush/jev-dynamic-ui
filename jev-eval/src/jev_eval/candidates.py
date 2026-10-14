"""Find candidate values in the text with code. Jev then picks which candidate fills each parameter.

Jev chooses; it never writes text. So the regexes deliberately over-find: they only need the right
value to be somewhere in the list.
"""

import re
from decimal import Decimal, InvalidOperation

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"\(?\+?\d[\d\s()\-.]{6,}\d")
MONEY_RE = re.compile(r"\$?\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:k|dollars?|bucks|cad))?", re.IGNORECASE)
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")

MAX_NAME_WORDS = 3
MAX_OPTIONS = 250  # a Choice allows at most 255 options


def _dedupe(spans: list[str]) -> list[str]:
    seen: dict[str, None] = {}  # a dict keeps insertion order, unlike a set
    for span in spans:
        span = span.strip(" ,.")
        if span:
            seen.setdefault(span, None)
    return list(seen)[:MAX_OPTIONS]


def find_emails(text: str) -> list[str]:
    return _dedupe(EMAIL_RE.findall(text))


def find_phones(text: str) -> list[str]:
    return _dedupe([p for p in PHONE_RE.findall(text) if len(re.sub(r"\D", "", p)) >= 7])


def find_amounts(text: str) -> list[str]:
    without_contacts = PHONE_RE.sub(" ", EMAIL_RE.sub(" ", text))
    return _dedupe(MONEY_RE.findall(without_contacts))


def find_names(text: str) -> list[str]:
    """Every run of 1 to 3 words. Short chat messages keep this list small."""
    words = WORD_RE.findall(EMAIL_RE.sub(" ", text))
    spans = [" ".join(words[i : i + n]) for n in range(1, MAX_NAME_WORDS + 1) for i in range(len(words) - n + 1)]
    return _dedupe(spans)


FINDERS = {"email": find_emails, "phone": find_phones, "amount": find_amounts, "name": find_names}


def normalize(param_type: str, span: str) -> str:
    """Turn the picked span into a clean value the UI can use."""
    if param_type == "email":
        return span.lower()
    if param_type == "phone":
        return re.sub(r"[^\d+]", "", span)
    if param_type == "amount":
        thousands = span.lower().rstrip().endswith("k")
        try:
            value = Decimal(re.sub(r"[^\d.]", "", span))
        except InvalidOperation:
            return span
        return f"{value * 1000 if thousands else value:.2f}"
    return span
