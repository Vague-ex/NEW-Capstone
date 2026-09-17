"""
Name parsing for the graduate masterlist.

Registration gates on an exact family-name match against
GraduateMasterRecord.last_name (see AlumniRegisterView), so a badly derived
surname does not merely look untidy — it locks a real graduate out of the
system. The masterlist importer previously took "the last whitespace-separated
token", which fails on the two shapes that actually occur in Philippine
registrar exports:

    "Rolly Lerit Samson Jr."  -> "Jr."   (suffix swallowed the surname)
    "Samson, Rolly Lerit"     -> "Lerit" (comma format read back-to-front)
"""

import re
import unicodedata

# Generational and honorific suffixes, matched case-insensitively and with any
# trailing period ignored.
_SUFFIXES = {
    "jr", "sr", "ii", "iii", "iv", "v", "vi",
}

# Particles that belong to the surname rather than the given names. Without
# these, "Jose Dela Cruz" collapses to "Cruz" and the graduate is locked out of
# registration just as surely as by the suffix bug — compound surnames are
# extremely common in Philippine registrar data.
_SURNAME_PARTICLES = {
    "de", "dela", "del", "delos", "delas", "dels",
    "la", "las", "los", "le",
    "san", "santa", "sta", "sto", "santo",
    "van", "von", "da", "di", "du", "dos", "das",
}


def _strip_punct(token: str) -> str:
    return re.sub(r"[.,]", "", token).strip()


def is_suffix(token: str) -> bool:
    return _strip_punct(token).lower() in _SUFFIXES


def derive_last_name(full_name: str) -> str:
    """
    Best-effort surname from a masterlist full name.

    Handles "Last, First Middle" explicitly, skips trailing generational
    suffixes, and falls back to the whole string when there is only one token.
    """
    name = (full_name or "").strip()
    if not name:
        return ""

    # "Samson, Rolly Lerit" — everything before the comma is the surname.
    if "," in name:
        head = name.split(",", 1)[0].strip()
        if head:
            return head

    tokens = [t for t in name.split() if t.strip()]
    if not tokens:
        return ""
    if len(tokens) == 1:
        return tokens[0]

    # Walk backwards past any suffixes ("Jr.", "III") to the real surname.
    index = len(tokens) - 1
    while index > 0 and is_suffix(tokens[index]):
        index -= 1

    # Absorb any preceding particles ("Dela", "De Los") into the surname, but
    # never consume the first token — a name must keep at least one given name.
    start = index
    while start > 1 and _strip_punct(tokens[start - 1]).lower() in _SURNAME_PARTICLES:
        start -= 1

    return " ".join(tokens[start:index + 1])


def normalize_name(value: str) -> str:
    """
    Comparable form of a name: accents stripped, case folded, punctuation
    dropped and whitespace collapsed. "Peña-Dela Cruz, Jr." and
    "pena dela  cruz jr" compare equal, so a graduate is not left unmatched
    over how the registrar or the graduate typed the same name.
    """
    decomposed = unicodedata.normalize("NFKD", value or "")
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(re.sub(r"[^\w\s]|_|\d", " ", stripped.casefold()).split())


def names_match(full_name: str, last_name: str, family_name: str, first_name: str) -> bool:
    """
    Whether a masterlist row (full_name / stored last_name) is the graduate who
    typed family_name + first_name.

    The surname must equal the stored last_name, or the surname re-derived from
    full_name (older rows were saved with a badly derived last_name). Every word
    of the typed first name must match a word of the masterlist full name,
    where either may be a shortened form of the other ("Ma." / "Maria",
    "Juan" / "Juanito"). The exact surname and batch year keep that loose
    first-name rule from matching the wrong graduate.
    """
    family = normalize_name(family_name)
    first_tokens = normalize_name(first_name).split()
    if not family or not first_tokens:
        return False
    surnames = {normalize_name(last_name), normalize_name(derive_last_name(full_name))}
    if family not in surnames:
        return False
    full_tokens = normalize_name(full_name).split()
    return all(_given_name_matches(token, full_tokens) for token in first_tokens)


def _given_name_matches(token: str, candidates: list[str]) -> bool:
    for candidate in candidates:
        if token == candidate:
            return True
        # A one-letter initial ("M") is too weak to count as a shortened name.
        shorter, longer = sorted((token, candidate), key=len)
        if len(shorter) >= 2 and longer.startswith(shorter):
            return True
    return False
