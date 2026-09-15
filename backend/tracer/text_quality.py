"""
Plausibility checks for text people type into the tracer.

Shared by intake validation and the `audit_data_quality` command, so "bad
data" means the same thing when it is refused at the door and when stored rows
are scanned later. Every function returns a short reason, or None when the
value looks fine.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date

# Whole-word matches. English and Filipino terms seen in form spam. Kept to
# unambiguous words: short ones that are also real names or places (e.g. "Pepe",
# "Tae") are left out so real graduates are never blocked.
PROFANE_WORDS = {
    # English, including common dodges ("fvck", "phuck")
    "fuck", "fucker", "fucking", "motherfucker", "fvck", "fck", "fuk", "phuck", "shit", "shyt", "bullshit",
    "bitch", "biatch", "asshole", "dick", "dickhead", "cunt", "bastard", "whore", "slut", "nigger", "nigga",
    "faggot", "fag", "retard", "porn", "pussy", "cock",
    # Filipino
    "putangina", "tangina", "tanginamo", "tangna", "tngina", "putang", "puta", "pota", "gago", "gaga", "ulol",
    "tarantado", "bobo", "leche", "pakyu", "kupal", "hindot", "pokpok", "burat", "titi", "puki", "kantot",
    "jakol", "bilat", "inutil", "tanga", "punyeta", "yawa", "buang",
}
# Also ordinary names or nicknames ("Dick Gordon"), so they are not held against
# a person's name. They still count in job titles and free-text answers.
_AMBIGUOUS_IN_NAMES = {"dick", "cock", "fag"}
# Also caught when letters are spaced or punctuated apart ("p u t a n g i n a").
# Only long terms, so ordinary names that merely contain a short one never match.
_SQUASHED_TERMS = {w for w in PROFANE_WORDS if len(w) >= 6}

_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"})


def _fold(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    folded = ascii_text.lower().translate(_LEET)
    return re.sub(r"(.)\1+", r"\1", folded)  # "fuuuck" -> "fuck"


def profanity_problem(value: str | None, *, person_name: bool = False) -> str | None:
    if not value:
        return None
    folded = _fold(str(value))
    words = re.findall(r"[a-z]+", folded)
    banned = PROFANE_WORDS - _AMBIGUOUS_IN_NAMES if person_name else PROFANE_WORDS
    collapsed_list = {re.sub(r"(.)\1+", r"\1", w) for w in banned}
    for word in words:
        if word in banned or word in collapsed_list:
            return "contains a vulgar word"
    squashed = "".join(words)
    for term in _SQUASHED_TERMS:
        if re.sub(r"(.)\1+", r"\1", term) in squashed:
            return "contains a vulgar word"
    return None


def person_name_problem(value: str | None, *, required: bool = False) -> str | None:
    """Letters, spaces, hyphens, apostrophes and periods only ("Ma. Ñiña O'Neil-Reyes")."""
    text = (value or "").strip()
    if not text:
        return "is blank" if required else None
    if re.search(r"\d", text):
        return "contains digits"
    if re.search(r"[^\w .'\-]", text) or "_" in text:
        return "contains symbols"
    if not re.search(r"[^\W\d_]", text):
        return "has no letters"
    return profanity_problem(text, person_name=True)


def job_text_problem(value: str | None) -> str | None:
    """A job title or company: must contain letters, not be a bare number or a single letter, and be clean."""
    text = (value or "").strip()
    if not text:
        return None
    if not re.search(r"[^\W\d_]", text):
        return "has no letters"
    if len(re.sub(r"[^\w]", "", text)) < 2:
        return "is too short"
    return profanity_problem(text)


_PH_MOBILE = re.compile(r"^(09|\+639|639)\d{9}$")


def ph_mobile_problem(value: str | None) -> str | None:
    text = re.sub(r"[\s\-()]", "", value or "")
    if not text:
        return None
    return None if _PH_MOBILE.match(text) else "is not a PH mobile number (09XXXXXXXXX)"


_YEAR_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def year_month_problem(value: str | None, *, min_age: int | None = None, max_age: int | None = None) -> str | None:
    """Stored month + year ("YYYY-MM"), optionally within an age window."""
    text = (value or "").strip()
    if not text:
        return None
    match = _YEAR_MONTH.match(text)
    if not match:
        return "is not in YYYY-MM format"
    year = int(match.group(1))
    this_year = date.today().year
    if year > this_year:
        return "is in the future"
    if min_age is not None and this_year - year < min_age:
        return f"means an age under {min_age}"
    if max_age is not None and this_year - year > max_age:
        return f"means an age over {max_age}"
    return None
