"""Build the exposure table (cars registered at a snapshot) with normalised models.

About 27 % of passenger cars in the DGT stock file have MODELO masked with «¡» (the DGT
masks any value seen five times or fewer, and MODELO is free text). Those cars are not
dropped: each one is shared out among the models of its own brand that look like it, in
proportion to the unmasked cars of the same cell (hot-deck by cells). Cells go from fine to
coarse and the first one with at least MIN_DONORS unmasked cars is used:

  1. brand, homologation type (TIPO), first-registration year, fuel, displacement, power
  2. brand, year, fuel, displacement, power, kerb weight (50 kg)
  3. brand, year, fuel, displacement, power
  4. brand, year, fuel, displacement
  5. brand, year, fuel
  6. brand, year
  7. brand

Cars whose brand is also masked stay in national, fuel and province totals only.
"""
from __future__ import annotations

import duckdb

MIN_DONORS = 10

FUEL_SQL = """CASE
  WHEN {cat} IN ('BEV', 'REEV', 'FCEV') THEN 'electrico'
  WHEN {cat} = 'PHEV' THEN 'enchufable'
  WHEN {cat} = 'HEV' THEN 'hibrido'
  WHEN {prop} IN ('0', 'G') THEN 'gasolina'
  WHEN {prop} IN ('1', 'D') THEN 'diesel'
  WHEN {prop} = '2' THEN 'electrico'
  WHEN {prop} IN ('4', '6', '7', '8', 'A') THEN 'gas'
  ELSE 'otros' END"""

LEVELS = [
    ("brand", "tipo", "prim_year", "fuel", "cc", "kw"),
    ("brand", "prim_year", "fuel", "cc", "kw", "tara"),
    ("brand", "prim_year", "fuel", "cc", "kw"),
    ("brand", "prim_year", "fuel", "cc"),
    ("brand", "prim_year", "fuel"),
    ("brand", "prim_year"),
    ("brand",),
]


def build_exposure(con: duckdb.DuckDBPyConnection, parque_file: str, out_table: str) -> dict:
    """Creates `out_table`(brand, model, segment, cataloged, fuel, kw, cc, provincia, prim_year, age, n, imputed)."""
    con.execute(f"""
    CREATE OR REPLACE TEMP TABLE _p AS
    SELECT nm.brand, nm.model, nm.segment, nm.cataloged,
           p.marca, coalesce(p.modelo LIKE '%¡%' OR p.marca LIKE '%¡%', false) AS masked,
           CASE WHEN p.tipo = '' OR p.tipo LIKE '%¡%' THEN NULL ELSE p.tipo END AS tipo,
           p.tara, {FUEL_SQL.format(cat='p.catelect', prop='p.propulsion')} AS fuel,
           p.kw, p.cc, p.provincia, p.prim_year, p.age, p.n
    FROM read_parquet('{parque_file}') p
    LEFT JOIN names nm ON nm.marca = p.marca AND nm.modelo = p.modelo
    """)
    # Brand of masked-model rows: the brand alone, normalised like the others.
    con.execute("""
    UPDATE _p SET brand = b.brand FROM brand_names b
    WHERE _p.masked AND _p.brand IS NULL AND b.marca = _p.marca
    """)
    con.execute("CREATE OR REPLACE TEMP TABLE _donor AS SELECT * FROM _p WHERE NOT masked AND model IS NOT NULL")
    con.execute("""CREATE OR REPLACE TEMP TABLE _todo AS
        SELECT brand, tipo, prim_year, fuel, cc, kw, tara, provincia, age, sum(n) AS n
        FROM _p WHERE masked AND brand IS NOT NULL GROUP BY ALL""")
    con.execute("CREATE OR REPLACE TEMP TABLE _assigned (brand VARCHAR, model VARCHAR, segment VARCHAR, cataloged BOOLEAN, "
                "fuel VARCHAR, kw INTEGER, cc INTEGER, provincia VARCHAR, prim_year BIGINT, age INTEGER, n DOUBLE, level INTEGER)")
    stats = {}
    for i, cols in enumerate(LEVELS, start=1):
        keys = ", ".join(cols)
        join = " AND ".join(f"t.{c} IS NOT DISTINCT FROM s.{c}" for c in cols)
        not_null = " AND ".join(f"{c} IS NOT NULL" for c in cols)
        con.execute(f"""
        CREATE OR REPLACE TEMP TABLE _shares AS
        WITH d AS (SELECT {keys}, model, any_value(segment) AS segment, bool_or(cataloged) AS cataloged, sum(n) AS n
                   FROM _donor WHERE {not_null} GROUP BY ALL),
             t AS (SELECT {keys}, sum(n) AS tot FROM d GROUP BY ALL HAVING sum(n) >= {MIN_DONORS})
        SELECT d.*, d.n / t.tot AS share FROM d JOIN t USING ({keys})
        """)
        con.execute(f"""
        INSERT INTO _assigned
        SELECT t.brand, s.model, s.segment, s.cataloged, t.fuel, t.kw, t.cc, t.provincia, t.prim_year, t.age,
               t.n * s.share, {i}
        FROM _todo t JOIN _shares s ON {join}
        """)
        before = con.execute("SELECT sum(n) FROM _todo").fetchone()[0] or 0
        con.execute(f"""
        DELETE FROM _todo t WHERE EXISTS (SELECT 1 FROM (SELECT DISTINCT {keys} FROM _shares) s WHERE {join})
        """)
        after = con.execute("SELECT sum(n) FROM _todo").fetchone()[0] or 0
        stats[f"nivel_{i}"] = int(before - after)
    stats["sin_asignar"] = int(con.execute("SELECT coalesce(sum(n), 0) FROM _todo").fetchone()[0])
    con.execute(f"""
    CREATE OR REPLACE TABLE {out_table} AS
    SELECT brand, model, segment, cataloged, fuel, kw, cc, provincia, prim_year, age, sum(n) AS n, 0.0 AS imputed
    FROM _p WHERE NOT masked GROUP BY ALL
    UNION ALL
    SELECT brand, model, segment, cataloged, fuel, kw, cc, provincia, prim_year, age, sum(n), sum(n)
    FROM _assigned GROUP BY ALL
    UNION ALL
    SELECT brand, NULL, NULL, NULL, fuel, kw, cc, provincia, prim_year, age, sum(n), 0.0
    FROM _todo GROUP BY ALL
    UNION ALL
    SELECT NULL, NULL, NULL, NULL, fuel, kw, cc, provincia, prim_year, age, sum(n), 0.0
    FROM _p WHERE masked AND brand IS NULL GROUP BY ALL
    """)
    tot, masked = con.execute("SELECT sum(n), sum(CASE WHEN masked THEN n ELSE 0 END) FROM _p").fetchone()
    stats.update(total=int(tot), enmascarados=int(masked))
    check = con.execute(f"SELECT sum(n) FROM {out_table}").fetchone()[0]
    if abs(check - tot) > 1:
        raise AssertionError(f"la imputación no conserva el total: {check} != {tot}")
    for t in ("_p", "_donor", "_todo", "_assigned", "_shares"):
        con.execute(f"DROP TABLE IF EXISTS {t}")
    return stats
