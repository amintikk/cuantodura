"""Paths and source URLs shared by the pipeline."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("CUANTODURA_DATA", ROOT / "data"))
BAJAS_DIR = DATA / "bajas"          # one Parquet per month: turismos, claves 3/4/7
PARQUE_DIR = DATA / "parque"        # one aggregated Parquet per monthly snapshot
RAW_DIR = DATA / "raw"              # transient downloads, deleted after processing
OUT_DIR = Path(os.environ.get("CUANTODURA_OUT", ROOT / "public" / "data"))

BAJAS_URL = "https://www.dgt.es/microdatos/salida/{y}/{m}/vehiculos/bajas/export_mensual_bajas_{y}{m:02d}.zip"
PARQUE_URL = "https://www.dgt.es/microdatos/Parque/parque_vehiculos_{y}{m:02d}.zip"
FIRST_BAJAS = (2015, 1)
FIRST_PARQUE = (2025, 3)
USER_AGENT = "cuantodura-data/1.0 (+https://cuantodura.aminox.dev/fuentes/)"

for d in (BAJAS_DIR, PARQUE_DIR, RAW_DIR):
    d.mkdir(parents=True, exist_ok=True)


def month_iter(start: tuple[int, int], end: tuple[int, int]):
    y, m = start
    while (y, m) <= end:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def add_months(ym: tuple[int, int], k: int) -> tuple[int, int]:
    t = ym[0] * 12 + (ym[1] - 1) + k
    return t // 12, t % 12 + 1
