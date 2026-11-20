"""Brand and model normalisation shared by the 'bajas' and 'parque' files.

The DGT names are free text typed at inspection time («IBIZA 1.9 TDI 5P.», «C220CDI»,
«GOLF», «KONA, KAUAI»). Both sources go through the same function so a car gets the
same key whether it is still registered or has been de-registered.

Rules (see catalog/modelos.csv, reviewable in the repository):
1. Clean: upper case, no accents, every non-alphanumeric character becomes a space.
2. Brand aliases from catalog/marcas.csv (MERCEDES / MERCEDES BENZ → MERCEDES-BENZ).
3. The first matching regex of that brand in catalog/modelos.csv gives the model and its segment.
   Body styles and engines are grouped (IBIZA 3P/5P/SC/ST, 1.4/1.9 TDI → Ibiza); product lines
   sold as different cars are kept apart (Mégane vs Scénic, Golf vs Golf Plus, C4 vs C4 Picasso).
4. Unlisted names fall back to their first word (two words if the first is a number) so the
   long tail is still grouped consistently in both sources; their segment is unknown.
5. Masked names (DGT replaces values seen ≤5 times with «¡») are left out.
"""
from __future__ import annotations

import csv
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

CATALOG = Path(__file__).resolve().parent / "catalog"
_NON_ALNUM = re.compile(r"[^A-Z0-9]+")
_SPLIT = re.compile(r"(?<=[A-Z])(?=[0-9])|(?<=[0-9])(?=[A-Z])")
_JOIN = re.compile(r"\b([A-Z]) (?=[0-9])")
LEAD = {"N", "NUEVO", "NUEVA", "NEW", "NOUVEAU", "NOUVELLE", "NUOVA", "NUOVO", "THE", "BENZ", "MB", "R", "E", "VW", "TODO", "MOD"}
STOP = {"NUEVO", "NEW", "NOUVELLE", "NUOVA", "THE", "MOD", "MODELO", "TURISMO", "BERLINA", "TODO", "TERRENO"}


def clean(s: str | None) -> str:
    if not s:
        return ""
    # In the parque file a stray latin-1 «á» (0xE1) sometimes separates words: «BERLINGOáTALLA M».
    s = unicodedata.normalize("NFKD", s.replace("á", " ").upper())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return _NON_ALNUM.sub(" ", s).strip()


def slugify(s: str) -> str:
    return clean(s).lower().replace(" ", "-")


def _rows(name: str):
    with open(CATALOG / name, encoding="utf-8") as f:
        for line in f:
            if line.strip() and not line.startswith("#"):
                yield line.rstrip("\n").split(";")


BRANDS: dict[str, str] = {clean(a): c for a, c in _rows("marcas.csv")}
RULES: dict[str, list[tuple[str, str, re.Pattern]]] = {}
SEGMENT: dict[tuple[str, str], str] = {}
for marca, modelo, segmento, *pat in _rows("modelos.csv"):
    key = (marca, modelo)
    if key in SEGMENT:
        continue
    pattern = (pat[0] if pat and pat[0] else r"^" + re.escape(clean(modelo)) + r"\b")
    RULES.setdefault(marca, []).append((modelo, segmento, re.compile(pattern)))
    SEGMENT[key] = segmento


REASSIGN: list[tuple[str, re.Pattern, str]] = [(m, re.compile(rx), new) for m, rx, new in _rows("reasignar.csv")]


@lru_cache(maxsize=None)
def brand(raw: str) -> str | None:
    if not raw or "¡" in raw:
        return None
    c = clean(raw)
    if not c:
        return None
    return BRANDS.get(c, c)


def variants(c: str) -> list[str]:
    """The cleaned name plus versions without leading noise and with letters/digits split or joined."""
    toks = c.split(" ")
    bases = [c]
    i = 0
    # «NUEVO C3», «N-C4», «R. MEGANE», «BENZ 300 D», «E-2008», «1.6 COROLLA»: drop up to three such tokens.
    lead_only = c
    while i < min(3, len(toks) - 1) and (toks[i] in LEAD or toks[i].isdigit()):
        if toks[i] in LEAD and lead_only == " ".join(toks[i:]):
            lead_only = " ".join(toks[i + 1:])
        i += 1
        bases.append(" ".join(toks[i:]))
    out: list[str] = [lead_only]
    for b in bases:
        for v in (b, _SPLIT.sub(" ", b), _JOIN.sub(r"\1", b)):
            if v not in out:
                out.append(v)
    return out


@lru_cache(maxsize=None)
def model(marca: str | None, raw: str) -> tuple[str, str, bool] | None:
    """(model name, segment, matched by a catalogue rule)."""
    if not marca or not raw or "¡" in raw:
        return None
    c = clean(raw)
    # Some entries repeat the brand («SEAT IBIZA», «MERCEDES-BENZ C 220»).
    for prefix in sorted({clean(marca), clean(marca).split(" ")[0]}, key=len, reverse=True):
        if c.startswith(prefix + " "):
            c = c[len(prefix) + 1:]
            break
    if not c:
        return None
    vs = variants(c)
    for name, seg, rx in RULES.get(marca, ()):
        if any(rx.search(v) for v in vs):
            return name, seg, True
    # Fallback: first meaningful word once leading noise words are gone; «R 8» → «R8».
    ct = c.split(" ")
    if len(ct) > 1 and len(ct[0]) == 1 and ct[0].isalpha() and ct[1].isdigit():
        return ct[0] + ct[1], "", False
    toks = [t for t in vs[0].split(" ") if t not in STOP] or ct
    first = toks[0]
    if len(toks) > 1 and len(first) == 1 and first.isalpha() and toks[1].isdigit():
        first = first + toks[1]
    elif first.isdigit() and len(toks) > 1 and not toks[1][0].isdigit():
        first = f"{first} {toks[1]}"
    return first.title(), "", False


@lru_cache(maxsize=None)
def reassign(marca: str, raw: str) -> str:
    """Brand corrections listed in catalog/reasignar.csv (e.g. MINI sold under BMW)."""
    c = clean(raw)
    for m, rx, new in REASSIGN:
        if m == marca and rx.search(c):
            return new
    return marca


def key(marca_raw: str, modelo_raw: str) -> tuple[str, str, str, bool] | None:
    b = brand(marca_raw)
    if b:
        b = reassign(b, modelo_raw)
    m = model(b, modelo_raw) if b else None
    if not m:
        return None
    return b, m[0], m[1], m[2]
