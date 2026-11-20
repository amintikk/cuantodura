"""Compare a freshly computed data set with the published one before going live.

Usage: python validate.py NEW_DIR [OLD_DIR]   → exit 0 if it can be published, 1 otherwise.
Prints a short report either way. Thresholds are deliberately loose for normal monthly
drift (the window moves one month) and strict for things that indicate a broken read.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def load(d: Path, name: str):
    return json.loads((d / f"{name}.json").read_text())


def main(argv: list[str]) -> int:
    new = Path(argv[1])
    old = Path(argv[2]) if len(argv) > 2 else None
    problems, notes = [], []
    ov = load(new, "overview")
    n = ov["national"]
    idx = load(new, "index")["models"]
    # Absolute sanity: a broken parse produces values far outside these ranges.
    if not 300_000 <= n["deaths"] <= 1_000_000:
        problems.append(f"bajas definitivas fuera de rango: {n['deaths']}")
    if not 15 <= (n["median"] or 0) <= 40:
        problems.append(f"vida mediana nacional fuera de rango: {n['median']}")
    if not 20_000_000 <= n["stock"] <= 35_000_000:
        problems.append(f"parque fuera de rango: {n['stock']}")
    if sum(1 for m in idx if m["enough"]) < 150:
        problems.append(f"pocos modelos publicables: {sum(1 for m in idx if m['enough'])}")
    if not (new / "m" / "seat-ibiza.json").exists():
        problems.append("falta seat-ibiza.json")
    if old and (old / "overview.json").exists():
        o = load(old, "overview")["national"]
        oidx = {m["slug"]: m for m in load(old, "index")["models"]}
        def rel(a, b):
            return abs(a - b) / b if b else 0
        if rel(n["deaths"], o["deaths"]) > 0.25:
            problems.append(f"bajas: {o['deaths']} → {n['deaths']} (más de ±25 %)")
        if abs(n["median"] - o["median"]) > 1.0:
            problems.append(f"vida mediana nacional: {o['median']} → {n['median']} (más de 1 año)")
        for k in ("15", "20"):
            if n["s"][k] is not None and o["s"][k] is not None and abs(n["s"][k] - o["s"][k]) > 0.03:
                problems.append(f"S({k}) nacional: {o['s'][k]} → {n['s'][k]}")
        if rel(n["stock"], o["stock"]) > 0.05:
            problems.append(f"parque: {o['stock']} → {n['stock']} (más de ±5 %)")
        ne, oe = sum(1 for m in idx if m["enough"]), sum(1 for m in oidx.values() if m["enough"])
        if ne < 0.9 * oe:
            problems.append(f"modelos publicables: {oe} → {ne}")
        big = sorted((m for m in idx if m["median"] is not None and m["slug"] in oidx and oidx[m["slug"]]["median"] is not None),
                     key=lambda m: -m["now"])[:30]
        moved = [(m["slug"], oidx[m["slug"]]["median"], m["median"]) for m in big if abs(m["median"] - oidx[m["slug"]]["median"]) > 2.5]
        if len(moved) > 3:
            problems.append(f"vida mediana de {len(moved)} modelos grandes cambia más de 2,5 años: {moved[:5]}")
        elif moved:
            notes.append(f"cambios notables: {moved}")
        notes.append(f"ventana {load(old, 'overview')['meta']['window']} → {ov['meta']['window']}; mediana {o['median']} → {n['median']}; bajas {o['deaths']} → {n['deaths']}")
    for p in problems:
        print("ANOMALÍA:", p)
    for x in notes:
        print("nota:", x)
    print("VALIDACIÓN", "FALLIDA" if problems else "CORRECTA")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
