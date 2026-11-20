"""Aggregate one monthly DGT vehicle-stock snapshot (parque) to passenger cars.

The ZIP (~1.7 GB, ~8 GB of text) is streamed through `unzip -p` into DuckDB; nothing
is extracted to disk. Output: data/parque/YYYYMM.parquet with one row per
(marca, modelo, tipo, tara, propulsion, catelect, kw, cc, provincia, prim_year, age) and a count.
tipo (homologation type) and tara (kerb weight, 50 kg steps) are kept only to impute the
model of the ~27 % of cars whose MODELO the DGT masks with «¡» (see impute.py).
Age is completed years at the snapshot date (last day of the month).
Usage: python ingest_parque.py 2026-09 [--keep-zip]
"""
from __future__ import annotations

import argparse
import calendar
import subprocess
import sys

import duckdb

from config import PARQUE_DIR, PARQUE_URL, RAW_DIR
from download import exists, fetch

COLUMNS = ("PROVINCIA MUNICIPIO FABRICANTE MARCA MODELO TIPO VARIANTE VERSION PROVINCIA_MATR FECHA_MATR "
           "FEC_PRIM_MATR CLASE_MATR PROCEDENCIA NUEVO_USADO TIPO_TITULAR NUM_TITULARES SUBTIPO_DGT TIPO_DGT "
           "CAT_EURO CLAS_CONSTRUCCION CLAS_UTILIZACION SERVICIO RENTING TARA PESO_MAX MOM MMTA CILINDRADA "
           "POTENCIA KW PROPULSION CATELECT CONSUMO AUTONOMIA ALIMENTACION TIPO_DISTINTIVO EMISIONES_EURO "
           "EMISIONES_CO2 CARROCERIA DISTANCIA_EJES EJE_ANTERIOR EJE_POSTERIOR PLAZAS PLAZAS_MAX PLAZAS_PIE").split()


def aggregate(zip_path, y: int, m: int, out) -> dict:
    snap = f"{y}-{m:02d}-{calendar.monthrange(y, m)[1]}"
    proc = subprocess.Popen(["unzip", "-p", str(zip_path)], stdout=subprocess.PIPE)
    con = duckdb.connect()
    con.execute("SET memory_limit='3GB'; SET threads=3; SET preserve_insertion_order=false;")
    con.execute(f"SET temp_directory='{RAW_DIR}/duck_tmp'")
    cols = ", ".join(f"'{c}': 'VARCHAR'" for c in COLUMNS)
    src = (f"read_csv('/dev/stdin', delim='|', header=true, quote='', escape='', encoding='latin-1', "
           f"columns={{{cols}}}, ignore_errors=true, store_rejects=false, strict_mode=false)")
    # Read the FIFO once: aggregate everything we need in a single pass.
    sql = f"""
    COPY (
      WITH s AS (
        SELECT TIPO_DGT, SUBTIPO_DGT, PROVINCIA AS provincia, trim(MARCA) AS marca, trim(MODELO) AS modelo,
               coalesce(trim(TIPO), '') AS tipo,
               CAST(round(try_cast(TARA AS DOUBLE) / 50) * 50 AS INTEGER) AS tara,
               PROPULSION AS propulsion, coalesce(CATELECT, '') AS catelect,
               try_cast(replace(KW, ',', '.') AS DOUBLE) AS kwf,
               try_cast(replace(CILINDRADA, ',', '.') AS DOUBLE) AS ccf,
               coalesce(try_strptime(FEC_PRIM_MATR, '%d/%m/%Y'), try_strptime(FECHA_MATR, '%d/%m/%Y'))::DATE AS prim
        FROM {src}
      )
      SELECT marca, modelo, tipo, tara, propulsion, catelect,
             CAST(round(kwf) AS INTEGER) AS kw, CAST(round(ccf / 100) * 100 AS INTEGER) AS cc,
             provincia, year(prim) AS prim_year,
             CAST(floor(datediff('day', prim, DATE '{snap}') / 365.25) AS INTEGER) AS age,
             count(*)::INTEGER AS n
      FROM s
      WHERE TIPO_DGT = 'TURISMOS' AND prim IS NOT NULL AND prim <= DATE '{snap}'
      GROUP BY ALL
    ) TO '{out}' (FORMAT parquet, COMPRESSION zstd)
    """
    import os
    os.dup2(proc.stdout.fileno(), 0)  # DuckDB reads /dev/stdin
    con.execute(sql)
    proc.wait()
    if proc.returncode not in (0,):
        raise RuntimeError(f"unzip terminó con {proc.returncode}")
    n, groups = con.execute(f"SELECT sum(n), count(*) FROM read_parquet('{out}')").fetchone()
    return {"turismos": int(n), "grupos": int(groups), "snapshot": snap}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("month")
    ap.add_argument("--zip", help="use an already-downloaded ZIP")
    ap.add_argument("--keep-zip", action="store_true")
    a = ap.parse_args(argv)
    y, m = map(int, a.month.split("-"))
    out = PARQUE_DIR / f"{y}{m:02d}.parquet"
    if a.zip:
        z = a.zip
    else:
        url = PARQUE_URL.format(y=y, m=m)
        if not exists(url):
            print(f"parque {a.month}: no publicado")
            return 2
        z = RAW_DIR / f"parque_{y}{m:02d}.zip"
        fetch(url, z)
    tmp = out.with_suffix(".tmp")
    try:
        stats = aggregate(z, y, m, tmp)
        tmp.rename(out)
        print(f"parque {a.month}: {stats}", flush=True)
    finally:
        tmp.unlink(missing_ok=True)
        if not a.zip and not a.keep_zip:
            from pathlib import Path
            Path(z).unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
