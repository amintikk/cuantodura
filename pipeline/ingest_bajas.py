"""Download the monthly DGT 'bajas' files and keep only passenger cars (COD_TIPO 40)
with definitive de-registrations (claves 3, 4) and exports (clave 7), as Parquet.

The raw ZIP is read as a stream (never extracted) and deleted afterwards.
Usage: python ingest_bajas.py [--from 2015-01] [--to 2026-10] [--force]
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import sys
import zipfile

import pyarrow as pa
import pyarrow.parquet as pq

from config import BAJAS_DIR, BAJAS_URL, FIRST_BAJAS, RAW_DIR, month_iter
from dgt_layout import RECORD_MIN, SLICES, parse_line
from download import exists, fetch

KEEP = {"3", "4", "7"}
TIPO, CLAVE = SLICES["COD_TIPO"], SLICES["CLAVE_TRAMITE"]
SCHEMA = pa.schema([
    ("fec_prim", pa.date32()), ("fec_matricula", pa.date32()), ("fec_tramite", pa.date32()),
    ("marca", pa.string()), ("modelo", pa.string()), ("propulsion", pa.string()), ("cat_elec", pa.string()),
    ("kw", pa.float32()), ("cilindrada", pa.float32()), ("titulares", pa.int16()), ("provincia", pa.string()),
    ("clave", pa.string()), ("motivo", pa.string()), ("servicio", pa.string()),
])


def parse_zip(path) -> tuple[pa.Table, dict]:
    cols: dict[str, list] = {f.name: [] for f in SCHEMA}
    stats = {"lines": 0, "short": 0, "turismos": 0}
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".txt"))
        for raw in io.TextIOWrapper(z.open(name), encoding="latin-1", newline=""):
            line = raw.rstrip("\r\n")
            stats["lines"] += 1
            if len(line) < RECORD_MIN - 120:  # trailing optional fields may be trimmed
                stats["short"] += 1
                continue
            line = line.ljust(RECORD_MIN)
            if line[TIPO] != "40" or line[CLAVE] not in KEEP:  # cheap pre-filter
                continue
            r = parse_line(line)
            if r["cod_tipo"] != "40" or r["clave"] not in KEEP:
                continue
            stats["turismos"] += 1
            for k in cols:
                cols[k].append(r[k])
    return pa.table(cols, schema=SCHEMA), stats


def ingest(y: int, m: int, force: bool = False) -> str:
    out = BAJAS_DIR / f"{y}{m:02d}.parquet"
    if out.exists() and not force:
        return "ya"
    url = BAJAS_URL.format(y=y, m=m)
    if not exists(url):
        return "no publicado"
    raw = RAW_DIR / f"bajas_{y}{m:02d}.zip"
    try:
        fetch(url, raw)
        table, stats = parse_zip(raw)
        if stats["lines"] == 0 or stats["short"] > stats["lines"] * 0.01:
            raise ValueError(f"lectura anómala {stats}")
        tmp = out.with_suffix(".tmp")
        pq.write_table(table, tmp, compression="zstd")
        tmp.rename(out)
        return f"{stats['turismos']} filas"
    finally:
        raw.unlink(missing_ok=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default=f"{FIRST_BAJAS[0]}-{FIRST_BAJAS[1]:02d}")
    today = dt.date.today()
    ap.add_argument("--to", dest="end", default=f"{today.year}-{today.month:02d}")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    s = tuple(map(int, a.start.split("-")))
    e = tuple(map(int, a.end.split("-")))
    for y, m in month_iter(s, e):  # type: ignore[arg-type]
        print(f"bajas {y}-{m:02d}: {ingest(y, m, a.force)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
