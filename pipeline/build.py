"""Compute every life table and write the static JSON consumed by the website.

Usage: python build.py [--end 2026-10] [--out public/data]

Period: the 12 months of 'bajas' files ending at --end (default: latest downloaded).
Exposure: the stock snapshot (parque) at the end of month end-6, i.e. mid-window.
"Now" figures (cars still registered, map): the latest parque snapshot.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import duckdb

import normalize as N
from config import BAJAS_DIR, OUT_DIR, PARQUE_DIR, add_months
from impute import FUEL_SQL, build_exposure
from lifetable import MAX_AGE, life_table, rates, smr
from provinces import LETTER_TO_INE, NAME as PROV_NAME

# Publication thresholds (see the Methodology page).
MIN_DEATHS = 150          # definitive de-registrations in the window
MIN_EXPOSURE = 3000       # cars registered at mid-window
MIN_AGE_EXPOSURE = 50     # below this, an age borrows the reference hazard
MEDIAN_MAX_CI = 8.0       # years; wider intervals are not published
MEDIAN_MIN_OBSERVED = 0.8
SUB_MIN_DEATHS = 60       # fuel / engine / generation breakdowns inside a model
RIVALS = 4
FUELS = ["gasolina", "diesel", "hibrido", "enchufable", "electrico", "gas"]
KW_BANDS = [(0, 55, "≤ 55 kW"), (55, 80, "55–80 kW"), (80, 110, "80–110 kW"), (110, 150, "110–150 kW"), (150, 10_000, "> 150 kW")]
GEN_BANDS = [(1900, 1994), (1995, 1999), (2000, 2004), (2005, 2009), (2010, 2014), (2015, 2019), (2020, 2100)]
MOTIVOS = {"7": "voluntaria", "0": "desguace", "A": "codigo_a", "C": "codigo_c", "4": "otros_motivos"}


def r(x, nd=4):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, nd)


def ym_str(ym):
    return f"{ym[0]}-{ym[1]:02d}"


def latest(dir_: Path) -> tuple[int, int]:
    names = sorted(p.stem for p in dir_.glob("*.parquet"))
    if not names:
        raise SystemExit(f"no hay datos en {dir_}")
    return int(names[-1][:4]), int(names[-1][4:])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--end")
    ap.add_argument("--out", default=str(OUT_DIR))
    a = ap.parse_args(argv)
    end = tuple(map(int, a.end.split("-"))) if a.end else latest(BAJAS_DIR)
    start = add_months(end, -11)
    mid = add_months(end, -6)
    window = [add_months(start, k) for k in range(12)]
    missing = [ym_str(m) for m in window if not (BAJAS_DIR / f"{m[0]}{m[1]:02d}.parquet").exists()]
    if missing:
        raise SystemExit(f"faltan meses de bajas en la ventana: {missing}")
    mid_file = PARQUE_DIR / f"{mid[0]}{mid[1]:02d}.parquet"
    if not mid_file.exists():
        raise SystemExit(f"falta el parque de mitad de periodo {ym_str(mid)}")
    now = latest(PARQUE_DIR)
    out = Path(a.out)
    tmp_out = out.with_name(out.name + ".new")
    shutil.rmtree(tmp_out, ignore_errors=True)
    (tmp_out / "m").mkdir(parents=True)

    con = duckdb.connect()
    con.execute("SET memory_limit='4GB'; SET threads=3; SET preserve_insertion_order=false")
    win_files = [str(BAJAS_DIR / f"{y}{m:02d}.parquet") for y, m in window]
    con.execute(f"CREATE TABLE bw AS SELECT * FROM read_parquet({win_files!r})")

    # ---- name normalisation (same function for both sources) -------------------------------
    pairs = con.execute(f"""
        SELECT DISTINCT marca, modelo FROM bw
        UNION SELECT DISTINCT marca, modelo FROM read_parquet('{mid_file}')
        UNION SELECT DISTINCT marca, modelo FROM read_parquet('{PARQUE_DIR / f'{now[0]}{now[1]:02d}.parquet'}')
    """).fetchall()
    rows, brows = [], {}
    for marca, modelo in pairs:
        k = N.key(marca or "", modelo or "")
        if k:
            rows.append((marca, modelo, k[0], k[1], k[2], k[3]))
        if marca not in brows:
            brows[marca] = N.brand(marca or "")
    con.execute("CREATE TABLE names (marca VARCHAR, modelo VARCHAR, brand VARCHAR, model VARCHAR, segment VARCHAR, cataloged BOOLEAN)")
    con.executemany("INSERT INTO names VALUES (?, ?, ?, ?, ?, ?)", rows)
    con.execute("CREATE TABLE brand_names (marca VARCHAR, brand VARCHAR)")
    con.executemany("INSERT INTO brand_names VALUES (?, ?)", [(k, v) for k, v in brows.items() if v])

    # ---- exposure (mid-window) and stock (now) ---------------------------------------------
    imp_mid = build_exposure(con, str(mid_file), "expo")
    imp_now = imp_mid if now == mid else build_exposure(con, str(PARQUE_DIR / f"{now[0]}{now[1]:02d}.parquet"), "stock")
    if now == mid:
        con.execute("CREATE TABLE stock AS SELECT * FROM expo")
    print("imputación (mitad):", imp_mid, flush=True)

    # ---- deaths and exports in the window ---------------------------------------------------
    prov_case = "CASE " + " ".join(f"WHEN b.provincia = '{l}' THEN '{i}'" for l, i in LETTER_TO_INE.items()) + " ELSE NULL END"
    con.execute(f"""
    CREATE TABLE ev AS
    SELECT nm.brand, nm.model, nm.segment, nm.cataloged,
           {FUEL_SQL.format(cat='b.cat_elec', prop='b.propulsion')} AS fuel,
           CAST(round(b.kw) AS INTEGER) AS kw, CAST(round(b.cilindrada / 100) * 100 AS INTEGER) AS cc,
           {prov_case} AS provincia, year(b.fec_prim) AS prim_year,
           CAST(floor(datediff('day', b.fec_prim, b.fec_tramite) / 365.25) AS INTEGER) AS age,
           b.clave, b.motivo
    FROM bw b LEFT JOIN names nm ON nm.marca = b.marca AND nm.modelo = b.modelo
    WHERE b.fec_prim IS NOT NULL AND b.fec_tramite IS NOT NULL AND b.fec_tramite >= b.fec_prim
    """)

    def table(where: str = "TRUE", by: str = "", src_where: str | None = None):
        """{group: (deaths[age], exports[age], exposure[age])} for ages 0..MAX_AGE-1."""
        g = f"{by}, " if by else ""
        q = f"""
        WITH d AS (SELECT {g} age, sum(CASE WHEN clave IN ('3', '4') THEN 1 ELSE 0 END) AS d,
                          sum(CASE WHEN clave = '7' THEN 1 ELSE 0 END) AS x
                   FROM ev WHERE {where} AND age BETWEEN 0 AND {MAX_AGE - 1} GROUP BY ALL),
             p AS (SELECT {g} age, sum(n) AS p FROM expo
                   WHERE {src_where or where} AND age BETWEEN 0 AND {MAX_AGE - 1} GROUP BY ALL)
        SELECT {g} age, coalesce(d.d, 0), coalesce(d.x, 0), coalesce(p.p, 0)
        FROM d FULL OUTER JOIN p USING ({g} age)
        """
        res: dict = defaultdict(lambda: ([0.0] * MAX_AGE, [0.0] * MAX_AGE, [0.0] * MAX_AGE))
        nkeys = len([c for c in by.split(",") if c.strip()]) if by else 0
        for row in con.execute(q).fetchall():
            key = tuple(row[:nkeys]) if nkeys else ()
            age = row[nkeys]
            D, X, P = res[key]
            D[age] += float(row[nkeys + 1])
            X[age] += float(row[nkeys + 2])
            P[age] += float(row[nkeys + 3])
        return res

    # ---- reference tables --------------------------------------------------------------------
    nat = table()[()]
    nat_lt = life_table(nat[0], nat[2])
    nat_m = rates(nat[0], nat[2])
    nat_q = nat_lt.q
    sens = table("NOT (clave = '3' AND motivo IN ('A', '4'))", src_where="TRUE")[()]
    sens_lt = life_table(sens[0], sens[2])

    def summary(lt, D, X, P, ref_m=nat_m, extra_ok=True):
        dsum, psum = sum(D), sum(P)
        enough = dsum >= MIN_DEATHS and psum >= MIN_EXPOSURE
        med_ok = (enough and extra_ok and lt.median is not None and lt.median_lo is not None and lt.median_hi is not None
                  and lt.median_hi - lt.median_lo <= MEDIAN_MAX_CI and lt.median_observed_share >= MEDIAN_MIN_OBSERVED)
        s = smr(D, P, ref_m)
        obs_max = max([x for x in range(MAX_AGE) if lt.observed[x]], default=-1)
        return {
            "deaths": int(dsum), "exports": int(sum(X)), "exposure": int(round(psum)), "enough": enough,
            "median": r(lt.median, 2) if med_ok else None,
            "median_lo": r(lt.median_lo, 2) if med_ok else None,
            "median_hi": r(lt.median_hi, 2) if med_ok else None,
            "median_hint": r(lt.median, 1) if (not med_ok and lt.median is not None and enough) else None,
            "s": {str(k): (r(lt.S[k]) if (enough and k - 1 <= obs_max) else None) for k in (5, 10, 15, 20, 25, 30)},
            "index": r(s["index"], 1) if enough else None, "index_lo": r(s["lo"], 1) if enough else None,
            "index_hi": r(s["hi"], 1) if enough else None,
            "export_rate": r(100 * sum(X) / psum, 3) if psum else None,
            "observed_to": obs_max,
        }

    def curve(lt):
        return {"S": [r(v) for v in lt.S], "lo": [r(v) for v in lt.lo], "hi": [r(v) for v in lt.hi],
                "obs": [1 if o else 0 for o in lt.observed], "q": [r(v, 5) for v in lt.q]}

    # Segment and brand reference tables (the reference for borrowed ages of each model).
    seg_t = table("segment IS NOT NULL AND segment <> ''", "segment")
    seg_lt = {k[0]: life_table(v[0], v[2], ref_q=nat_q, min_exposure=MIN_AGE_EXPOSURE) for k, v in seg_t.items()}
    brand_t = table("brand IS NOT NULL", "brand")
    brand_lt = {k[0]: life_table(v[0], v[2], ref_q=nat_q, min_exposure=MIN_AGE_EXPOSURE) for k, v in brand_t.items()}
    fuel_t = table("TRUE", "fuel")
    fuel_lt = {k[0]: life_table(v[0], v[2], ref_q=nat_q, min_exposure=MIN_AGE_EXPOSURE) for k, v in fuel_t.items()}

    # ---- models -----------------------------------------------------------------------------
    mod_t = table("cataloged AND model IS NOT NULL", "brand, model, segment")
    stock_rows = con.execute("""SELECT brand, model, sum(n), sum(imputed) FROM stock
                                WHERE cataloged GROUP BY ALL""").fetchall()
    stock_n = {(b, m): (n, imp) for b, m, n, imp in stock_rows}
    expo_imp = {(b, m): (n, imp) for b, m, n, imp in con.execute(
        "SELECT brand, model, sum(n), sum(imputed) FROM expo WHERE cataloged GROUP BY ALL").fetchall()}

    def slug_of(brand, model):
        return N.slugify(f"{brand} {model}").replace("mercedes-benz", "mercedes")

    models = {}
    for (brand, model, segment), (D, X, P) in mod_t.items():
        ref = seg_lt.get(segment) or brand_lt.get(brand) or nat_lt
        lt = life_table(D, P, ref_q=ref.q, min_exposure=MIN_AGE_EXPOSURE)
        smy = summary(lt, D, X, P)
        n_now, imp_now_m = stock_n.get((brand, model), (0, 0))
        if sum(P) < 500 and n_now < 500:
            continue
        slug = slug_of(brand, model)
        models[slug] = {
            "slug": slug, "brand": brand, "brand_name": brand.title() if brand.isupper() and len(brand) > 3 else brand,
            "model": model, "segment": segment, "lt": lt, "D": D, "X": X, "P": P, "summary": smy,
            "now": int(round(n_now)), "imputed_share": r(expo_imp.get((brand, model), (1, 0))[1] / max(1, expo_imp.get((brand, model), (1, 0))[0]), 3),
        }
    print(f"modelos: {len(models)}, publicables: {sum(1 for m in models.values() if m['summary']['enough'])}", flush=True)

    # Display names for brands.
    BRAND_DISPLAY = {"MERCEDES-BENZ": "Mercedes-Benz", "BMW": "BMW", "MG": "MG", "DS": "DS", "SEAT": "SEAT", "KIA": "Kia",
                     "MINI": "MINI", "BYD": "BYD", "CUPRA": "Cupra", "SKODA": "Škoda", "CITROEN": "Citroën",
                     "ALFA ROMEO": "Alfa Romeo", "LAND ROVER": "Land Rover", "SSANGYONG": "SsangYong", "LYNK & CO": "Lynk & Co",
                     "VOLKSWAGEN": "Volkswagen", "DACIA": "Dacia", "AUDI": "Audi", "FIAT": "Fiat", "TESLA": "Tesla",
                     "EBRO": "Ebro", "OMODA": "Omoda", "JAECOO": "Jaecoo", "LEAPMOTOR": "Leapmotor", "DR": "DR"}

    def bdisp(b):
        return BRAND_DISPLAY.get(b, b.title())

    for m in models.values():
        m["brand_name"] = bdisp(m["brand"])
        m["name"] = f"{m['brand_name']} {m['model']}"

    # ---- breakdowns per model ----------------------------------------------------------------
    def by_model(by: str, where: str = "TRUE"):
        t = table(f"cataloged AND model IS NOT NULL AND {where}", f"brand, model, {by}")
        out = defaultdict(dict)
        for key, v in t.items():
            out[slug_of(key[0], key[1])][key[2:] if len(key) > 3 else key[2]] = v
        return out

    fuel_by = by_model("fuel")
    engine_by = by_model("fuel, cc", "cc > 0")
    kw_case = "CASE " + " ".join(f"WHEN kw > {lo} AND kw <= {hi} THEN '{lab}'" for lo, hi, lab in KW_BANDS) + " END"
    con.execute(f"ALTER TABLE ev ADD COLUMN kwband VARCHAR; UPDATE ev SET kwband = {kw_case} WHERE kw > 0")
    con.execute(f"ALTER TABLE expo ADD COLUMN kwband VARCHAR; UPDATE expo SET kwband = {kw_case} WHERE kw > 0")
    gen_case = "CASE " + " ".join(f"WHEN prim_year BETWEEN {a} AND {b} THEN '{a if a > 1900 else ''}–{b if b < 2100 else ''}'" for a, b in GEN_BANDS) + " END"
    con.execute(f"ALTER TABLE ev ADD COLUMN gen VARCHAR; UPDATE ev SET gen = {gen_case}")
    con.execute(f"ALTER TABLE expo ADD COLUMN gen VARCHAR; UPDATE expo SET gen = {gen_case}")
    kw_by = by_model("kwband", "kwband IS NOT NULL")
    gen_by = by_model("gen")

    motivos = defaultdict(lambda: defaultdict(int))
    for b, mo, clave, motivo, n, x_age in con.execute("""
        SELECT brand, model, clave, motivo, count(*), median(age) FILTER (WHERE clave = '7')
        FROM ev WHERE cataloged GROUP BY ALL""").fetchall():
        key = "renove" if clave == "4" else ("exportacion" if clave == "7" else MOTIVOS.get(motivo, "otros"))
        motivos[slug_of(b, mo)][key] += n
    export_age = {slug_of(b, mo): a_ for b, mo, a_ in con.execute(
        "SELECT brand, model, median(age) FROM ev WHERE cataloged AND clave = '7' GROUP BY ALL").fetchall()}
    band = "CASE WHEN age < 5 THEN 'young' WHEN age >= 15 THEN 'old' ELSE 'mid' END"
    exp_bands = defaultdict(lambda: {k: {"n": 0, "stock": 0} for k in ("young", "mid", "old")})
    for b, mo, bd, n in con.execute(f"SELECT brand, model, {band}, count(*) FROM ev WHERE cataloged AND clave = '7' GROUP BY ALL").fetchall():
        exp_bands[slug_of(b, mo)][bd]["n"] = n
    for b, mo, bd, n in con.execute(f"SELECT brand, model, {band}, sum(n) FROM expo WHERE cataloged GROUP BY ALL").fetchall():
        exp_bands[slug_of(b, mo)][bd]["stock"] = int(round(n))
    nat_exp_bands = {k: {"n": 0, "stock": 0} for k in ("young", "mid", "old")}
    for bd, n in con.execute(f"SELECT {band}, count(*) FROM ev WHERE clave = '7' GROUP BY 1").fetchall():
        nat_exp_bands[bd]["n"] = n
    for bd, n in con.execute(f"SELECT {band}, sum(n) FROM expo GROUP BY 1").fetchall():
        nat_exp_bands[bd]["stock"] = int(round(n))
    death_age = {slug_of(b, mo): a_ for b, mo, a_ in con.execute(
        "SELECT brand, model, median(age) FROM ev WHERE cataloged AND clave IN ('3','4') GROUP BY ALL").fetchall()}

    prov_stock = defaultdict(dict)
    for b, mo, prov, n in con.execute("""SELECT brand, model, provincia, sum(n) FROM stock
                                         WHERE cataloged AND provincia IS NOT NULL GROUP BY ALL""").fetchall():
        prov_stock[slug_of(b, mo)][prov] = n
    prov_total = dict(con.execute("SELECT provincia, sum(n) FROM stock WHERE provincia IS NOT NULL GROUP BY 1").fetchall())
    year_stock = defaultdict(dict)
    for b, mo, y, n in con.execute("SELECT brand, model, prim_year, sum(n) FROM stock WHERE cataloged GROUP BY ALL").fetchall():
        year_stock[slug_of(b, mo)][int(y)] = n
    age_now = {slug_of(b, mo): a_ for b, mo, a_ in con.execute(
        "SELECT brand, model, sum(n * (age + 0.5)) / sum(n) FROM stock WHERE cataloged GROUP BY ALL").fetchall()}

    # ---- history 2015→ (all definitive de-registrations and exports) ----------------------------
    # The names table covers the window and the stock; add names only seen in older files.
    extra = con.execute("""SELECT DISTINCT b.marca, b.modelo FROM read_parquet('""" + str(BAJAS_DIR) + """/*.parquet') b
                           LEFT JOIN names nm ON nm.marca = b.marca AND nm.modelo = b.modelo WHERE nm.marca IS NULL""").fetchall()
    add = []
    for marca, modelo in extra:
        k = N.key(marca or "", modelo or "")
        if k:
            add.append((marca, modelo, k[0], k[1], k[2], k[3]))
    if add:
        con.executemany("INSERT INTO names VALUES (?, ?, ?, ?, ?, ?)", add)
    con.execute(f"""
    CREATE TABLE hist AS
    SELECT year(b.fec_tramite) AS y, month(b.fec_tramite) AS mth, b.clave,
           {FUEL_SQL.format(cat='b.cat_elec', prop='b.propulsion')} AS fuel,
           datediff('day', b.fec_prim, b.fec_tramite) / 365.25 AS agef, b.motivo, nm.brand, nm.model, nm.cataloged
    FROM read_parquet('{BAJAS_DIR}/*.parquet') b LEFT JOIN names nm ON nm.marca = b.marca AND nm.modelo = b.modelo
    WHERE b.fec_prim IS NOT NULL AND b.fec_tramite >= b.fec_prim AND b.fec_tramite >= DATE '2015-01-01'
      AND b.fec_tramite <= last_day(DATE '{end[0]}-{end[1]:02d}-01')
    """)
    hist_rows = con.execute("""
        SELECT y, clave IN ('3','4') AS def, count(*), median(agef), avg(agef)
        FROM hist GROUP BY ALL ORDER BY y""").fetchall()
    hist_mot = con.execute("""
        SELECT y, CASE WHEN motivo = '7' THEN 'voluntaria' WHEN motivo IN ('A', '4') THEN 'administrativa' ELSE 'otras' END,
               count(*), median(agef)
        FROM hist WHERE clave IN ('3','4') GROUP BY ALL""").fetchall()
    history = defaultdict(dict)
    for y, is_def, n, med, avg in hist_rows:
        history[int(y)]["bajas" if is_def else "export"] = {"n": n, "median_age": r(med, 2), "mean_age": r(avg, 2)}
    for y, grp, n, med in hist_mot:
        history[int(y)].setdefault("motivos", {})[grp] = {"n": n, "median_age": r(med, 2)}
    months_per_year = defaultdict(set)
    for y, mth in con.execute("SELECT DISTINCT y, mth FROM hist").fetchall():
        months_per_year[int(y)].add(int(mth))
    hist_fuel = defaultdict(dict)
    for y, fuel, n, med in con.execute("""SELECT y, fuel, count(*), median(agef) FROM hist WHERE clave IN ('3','4')
                                          GROUP BY ALL""").fetchall():
        hist_fuel[int(y)][fuel] = {"n": n, "median_age": r(med, 2)}
    model_hist = defaultdict(dict)
    hist_names = con.execute(f"""
        SELECT nm.brand, nm.model, year(b.fec_tramite) y, count(*), median(datediff('day', b.fec_prim, b.fec_tramite) / 365.25)
        FROM read_parquet('{BAJAS_DIR}/*.parquet') b JOIN names nm ON nm.marca = b.marca AND nm.modelo = b.modelo
        WHERE nm.cataloged AND b.clave IN ('3','4') AND b.fec_prim IS NOT NULL AND b.fec_tramite >= b.fec_prim
          AND b.fec_tramite >= DATE '2015-01-01' AND b.fec_tramite <= last_day(DATE '{end[0]}-{end[1]:02d}-01')
        GROUP BY ALL""").fetchall()
    for b, mo, y, n, med in hist_names:
        model_hist[slug_of(b, mo)][int(y)] = [n, r(med, 1)]

    # ---- provinces ---------------------------------------------------------------------------
    prov_t = table("provincia IS NOT NULL", "provincia")
    provinces = {}
    for (code,), (D, X, P) in prov_t.items():
        if code not in PROV_NAME:
            continue
        lt = life_table(D, P, ref_q=nat_q, min_exposure=MIN_AGE_EXPOSURE)
        s = smr(D, P, nat_m)
        provinces[code] = {"name": PROV_NAME[code], "deaths": int(sum(D)), "exports": int(sum(X)),
                           "median": r(lt.median, 2), "index": r(s["index"], 1), "index_lo": r(s["lo"], 1),
                           "index_hi": r(s["hi"], 1), "export_rate": r(100 * sum(X) / max(1, sum(P)), 3)}
    for code, n, mean_age, old20, old30, med_age in con.execute("""
        SELECT provincia, sum(n), sum(n * (age + 0.5)) / sum(n), sum(n) FILTER (WHERE age >= 20) / sum(n),
               sum(n) FILTER (WHERE age >= 30) / sum(n), NULL
        FROM stock WHERE provincia IS NOT NULL GROUP BY 1""").fetchall():
        if code in provinces:
            provinces[code].update(stock=int(n), mean_age=r(mean_age, 2), share_20=r(old20, 4), share_30=r(old30, 4))
    # median age of the stock per province (from the age histogram)
    hist_age = defaultdict(lambda: [0.0] * 81)
    for code, age, n in con.execute("SELECT provincia, least(age, 80), sum(n) FROM stock WHERE provincia IS NOT NULL GROUP BY ALL").fetchall():
        hist_age[code][int(age)] += n
    for code, h in hist_age.items():
        if code in provinces:
            tot, acc = sum(h), 0.0
            for age, n in enumerate(h):
                if acc + n >= tot / 2:
                    provinces[code]["median_age"] = r(age + (tot / 2 - acc) / n, 2)
                    break
                acc += n

    # ---- national figures --------------------------------------------------------------------
    stock_total = con.execute("SELECT sum(n) FROM stock").fetchone()[0]
    stock_age = con.execute("SELECT least(age, 60), sum(n) FROM stock GROUP BY 1 ORDER BY 1").fetchall()
    tot, acc, stock_median_age = sum(n for _, n in stock_age), 0.0, None
    for age, n in stock_age:
        if acc + n >= tot / 2:
            stock_median_age = age + (tot / 2 - acc) / n
            break
        acc += n
    death_median_age = con.execute("SELECT median(datediff('day', b.fec_prim, b.fec_tramite) / 365.25) FROM bw b "
                                    "WHERE clave IN ('3','4') AND fec_prim IS NOT NULL AND fec_tramite >= fec_prim").fetchone()[0]
    motivo_nat = defaultdict(int)
    for clave, motivo, n in con.execute("SELECT clave, motivo, count(*) FROM ev GROUP BY ALL").fetchall():
        key = "renove" if clave == "4" else ("exportacion" if clave == "7" else MOTIVOS.get(motivo, "otros"))
        motivo_nat[key] += n

    # ---- segments, fuels, brands rankings ---------------------------------------------------
    def group_entry(lt, D, X, P, label, extra=None):
        e = {"label": label, **summary(lt, D, X, P), "curve": curve(lt)}
        if extra:
            e.update(extra)
        return e

    segments = {k[0]: group_entry(seg_lt[k[0]], *v, k[0]) for k, v in seg_t.items()}
    fuels = {k[0]: group_entry(fuel_lt[k[0]], *v, k[0]) for k, v in fuel_t.items() if k[0] in FUELS}
    brands = {}
    for k, v in brand_t.items():
        e = group_entry(brand_lt[k[0]], *v, bdisp(k[0]))
        if e["enough"]:
            e["slug"] = N.slugify(k[0])
            brands[k[0]] = e

    # ---- write per-model JSON ------------------------------------------------------------------
    seg_members = defaultdict(list)
    for m in models.values():
        if m["summary"]["enough"] and m["segment"]:
            seg_members[m["segment"]].append(m)
    meta = {
        "window": [ym_str(start), ym_str(end)], "exposure_snapshot": ym_str(mid), "stock_snapshot": ym_str(now),
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "imputation": {"mid": imp_mid, "now": imp_now}, "max_age": MAX_AGE,
        "thresholds": {"min_deaths": MIN_DEATHS, "min_exposure": MIN_EXPOSURE, "min_age_exposure": MIN_AGE_EXPOSURE,
                       "median_max_ci": MEDIAN_MAX_CI, "median_min_observed": MEDIAN_MIN_OBSERVED, "sub_min_deaths": SUB_MIN_DEATHS},
    }

    def sub_entries(groups: dict, ref_q, label_fn, min_deaths=SUB_MIN_DEATHS, with_curve=False):
        res = []
        for key, (D, X, P) in groups.items():
            if sum(D) < min_deaths or sum(P) < MIN_EXPOSURE / 5:
                continue
            lt = life_table(D, P, ref_q=ref_q, min_exposure=MIN_AGE_EXPOSURE)
            s = smr(D, P, nat_m)
            obs_max = max([x for x in range(MAX_AGE) if lt.observed[x]], default=-1)
            e = {"key": key if isinstance(key, str) else list(key), "label": label_fn(key), "deaths": int(sum(D)),
                 "exposure": int(round(sum(P))), "index": r(s["index"], 1), "index_lo": r(s["lo"], 1), "index_hi": r(s["hi"], 1),
                 "s15": r(lt.S[15]) if obs_max >= 14 else None, "s20": r(lt.S[20]) if obs_max >= 19 else None,
                 "median": r(lt.median, 1) if (lt.median and lt.median_observed_share >= MEDIAN_MIN_OBSERVED and lt.median_hi
                                               and lt.median_lo and lt.median_hi - lt.median_lo <= MEDIAN_MAX_CI) else None}
            if with_curve:
                e["curve"] = {"S": [r(v) for v in lt.S], "obs": [1 if o else 0 for o in lt.observed]}
            res.append(e)
        return res

    index_list = []
    for slug, m in models.items():
        smy = m["summary"]
        ref = seg_lt.get(m["segment"]) or brand_lt.get(m["brand"]) or nat_lt
        rivals = sorted((x for x in seg_members.get(m["segment"], []) if x["slug"] != slug),
                        key=lambda x: -x["now"])[:RIVALS]
        doc = {
            "slug": slug, "name": m["name"], "brand": m["brand_name"], "brand_key": m["brand"], "model": m["model"],
            "segment": m["segment"], "summary": smy, "curve": curve(m["lt"]),
            "now": m["now"], "now_mean_age": r(age_now.get(slug), 1), "imputed_share": m["imputed_share"],
            "death_median_age": r(death_age.get(slug), 1), "export_median_age": r(export_age.get(slug), 1),
            "motivos": dict(motivos.get(slug, {})),
            "exports_by_age": exp_bands.get(slug),
            "fuels": sub_entries({k: v for k, v in fuel_by.get(slug, {}).items() if k in FUELS}, ref.q, lambda k: k, with_curve=True),
            "engines": sorted(sub_entries(engine_by.get(slug, {}), ref.q, lambda k: f"{k[0]}|{k[1]}"), key=lambda e: -e["deaths"])[:8],
            "power": sub_entries(kw_by.get(slug, {}), ref.q, lambda k: k),
            "generations": sorted(sub_entries(gen_by.get(slug, {}), ref.q, lambda k: k, min_deaths=40), key=lambda e: e["key"]),
            "provinces": {p: int(round(n)) for p, n in prov_stock.get(slug, {}).items() if n >= 0.5},
            "years": {str(y): int(round(n)) for y, n in sorted(year_stock.get(slug, {}).items()) if n >= 0.5},
            "history": {str(y): v for y, v in sorted(model_hist.get(slug, {}).items())},
            "rivals": [{"slug": x["slug"], "name": x["name"], "S": [r(v) for v in x["lt"].S],
                        "obs": [1 if o else 0 for o in x["lt"].observed], "median": x["summary"]["median"],
                        "index": x["summary"]["index"]} for x in rivals],
            "segment_curve": [r(v) for v in seg_lt[m["segment"]].S] if m["segment"] in seg_lt else None,
            "meta": {"window": meta["window"], "stock_snapshot": meta["stock_snapshot"]},
        }
        (tmp_out / "m" / f"{slug}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        index_list.append({
            "slug": slug, "name": m["name"], "brand": m["brand_name"], "model": m["model"], "segment": m["segment"],
            "now": m["now"], "enough": smy["enough"], "median": smy["median"], "median_lo": smy["median_lo"],
            "median_hi": smy["median_hi"], "median_hint": smy["median_hint"],
            "s10": smy["s"]["10"], "s15": smy["s"]["15"], "s20": smy["s"]["20"], "s25": smy["s"]["25"],
            "index": smy["index"], "index_lo": smy["index_lo"], "index_hi": smy["index_hi"],
            "export_rate": smy["export_rate"], "deaths": smy["deaths"], "exports": smy["exports"],
            "old_export_rate": (r(1000 * exp_bands[slug]["old"]["n"] / exp_bands[slug]["old"]["stock"], 2)
                                if slug in exp_bands and exp_bands[slug]["old"]["stock"] >= 2000 else None),
            "old_exports": exp_bands[slug]["old"]["n"] if slug in exp_bands else 0,
            "observed_to": smy["observed_to"],
            "fuel_mix": {k: round(sum(v[2]) / max(1, sum(m["P"])), 3) for k, v in fuel_by.get(slug, {}).items() if k in FUELS},
        })
    index_list.sort(key=lambda e: -e["now"])

    # Race: S(age) for the mature models with a published median.
    mature = [e for e in index_list if e["median"] is not None and e["s25"] is not None]
    race = {"ages": list(range(0, 31)), "models": [
        {"slug": e["slug"], "name": e["name"], "segment": e["segment"], "S": [r(models[e["slug"]]["lt"].S[a]) for a in range(31)],
         "median": e["median"]} for e in mature]}

    overview = {
        "meta": meta,
        "national": {**summary(nat_lt, *nat), "curve": curve(nat_lt), "m": [r(v, 6) for v in nat_m],
                     "stock": int(stock_total), "stock_median_age": r(stock_median_age, 2),
                     "death_median_age": r(death_median_age, 2), "motivos": dict(motivo_nat),
                     "exports_by_age": nat_exp_bands,
                     "stock_ages": [[int(a_), int(n)] for a_, n in stock_age],
                     "sensitivity_without_a": {"median": r(sens_lt.median, 2), "s20": r(sens_lt.S[20]), "s25": r(sens_lt.S[25])}},
        "fuels": fuels, "segments": segments,
        "history": {str(y): {**v, "months": len(months_per_year[y]), "fuels": hist_fuel.get(y, {})} for y, v in sorted(history.items())},
    }
    brand_curves = {k: {"label": v["label"], "slug": v["slug"], "S": v["curve"]["S"]} for k, v in brands.items()}
    rankings = {"brands": sorted(({k: v for k, v in b.items() if k != "curve"} for b in brands.values()),
                                 key=lambda e: -(e["median"] or 0)), "meta": meta}
    prov_doc = {"meta": meta, "provinces": provinces}

    for name, obj in (("overview", overview), ("index", {"meta": meta, "models": index_list}), ("race", race),
                      ("rankings", rankings), ("provinces", prov_doc)):
        (tmp_out / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    (tmp_out / "brands.json").write_text(json.dumps(brand_curves, ensure_ascii=False, separators=(",", ":")))

    # Swap atomically.
    if out.exists():
        old = out.with_name(out.name + ".old")
        shutil.rmtree(old, ignore_errors=True)
        out.rename(old)
        tmp_out.rename(out)
        shutil.rmtree(old, ignore_errors=True)
    else:
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp_out.rename(out)
    print(json.dumps({"ventana": meta["window"], "parque_mitad": meta["exposure_snapshot"], "parque_hoy": meta["stock_snapshot"],
                      "bajas_definitivas": overview["national"]["deaths"], "vida_mediana": overview["national"]["median"],
                      "modelos": len(index_list), "con_mediana": len(mature)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
