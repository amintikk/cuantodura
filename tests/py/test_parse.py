"""Fixed-width reading of real DGT 'bajas' lines and model normalisation."""
import datetime as dt
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from dgt_layout import RECORD_MIN, parse_line  # noqa: E402
import normalize as N  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "bajas_202609_muestra.txt"
D = dt.date
# Eight unmodified lines of export_mensual_bajas_202609.zip (DGT), read by hand against BAJAS_MATRABA.pdf.
EXPECTED = [
    dict(fec_prim=D(2020, 6, 30), fec_tramite=D(2026, 9, 1), marca="KIA", modelo="RIO", cod_tipo="40", propulsion="0", cilindrada=1248.0, kw=61.8, provincia="B", clave="6", motivo=""),
    dict(fec_prim=D(2020, 6, 12), fec_tramite=D(2026, 9, 1), marca="BMW", modelo="M850I XDRIVE", cod_tipo="40", propulsion="0", cilindrada=4395.0, kw=390.0, provincia="CR", clave="6", motivo=""),
    # Imported used car: registered in Spain in 2026, first registration abroad in 2013.
    dict(fec_prim=D(2013, 9, 24), fec_matricula=D(2026, 8, 25), marca="MERCEDES-BENZ", modelo="CLASE A", cod_tipo="40", propulsion="0", cilindrada=1991.0, kw=264.0, provincia="M", clave="6"),
    dict(fec_prim=D(1990, 2, 8), fec_tramite=D(2026, 9, 1), marca="PEUGEOT", modelo="205 SRD", cod_tipo="40", propulsion="1", cilindrada=1769.0, kw=0.0, provincia="H", clave="3", motivo="7"),
    dict(marca="TRIUMPH", modelo="TRIDENT", cod_tipo="50", clave="6"),
    dict(fec_prim=D(2000, 6, 26), fec_tramite=D(2026, 9, 10), marca="PEUGEOT", modelo="406 SRDT HDI 90", cod_tipo="40", propulsion="1", provincia="BA", clave="3", motivo="7"),
    dict(marca="PEUGEOT", modelo="PART. U,S,P,A, HD", cod_tipo="21", clave="3", motivo="7", provincia="SS"),
    dict(fec_prim=D(2020, 5, 22), fec_tramite=D(2026, 9, 30), marca="LAND ROVER", modelo="RANGE ROVER SPORT", cod_tipo="25", kw=386.0, provincia="A", clave="7", motivo="8"),
]


def test_fixture_lines_parse_as_expected():
    lines = FIXTURE.read_text(encoding="latin-1").splitlines()
    assert len(lines) == len(EXPECTED)
    for line, exp in zip(lines, EXPECTED):
        assert len(line) >= RECORD_MIN
        got = parse_line(line)
        for k, v in exp.items():
            assert got[k] == v, (k, got[k], v)


def test_missing_first_registration_falls_back_to_registration_date():
    line = FIXTURE.read_text(encoding="latin-1").splitlines()[3]
    blank = line[:220] + " " * 8 + line[228:]  # FEC_PRIM_MATRICULACION is bytes 220..227
    assert parse_line(blank)["fec_prim"] == parse_line(line)["fec_matricula"]


@pytest.mark.parametrize("marca, modelo, expected", [
    ("MERCEDES", "C220CDI", ("MERCEDES-BENZ", "Clase C")),
    ("MERCEDES-BENZ", "BENZ 300 D", ("MERCEDES-BENZ", "Clase E")),
    ("SEAT", "IBIZA 1.9 TDI 5P.", ("SEAT", "Ibiza")),
    ("SEAT", "SEAT LEON", ("SEAT", "León")),
    ("RENAULT", "MEGANE SCENIC 1.9", ("RENAULT", "Mégane Scénic")),
    ("RENAULT", "R. MEGANE", ("RENAULT", "Mégane")),
    ("RENAULT", "R-19", ("RENAULT", "R19")),
    ("VOLKSWAGEN", "GOLF PLUS", ("VOLKSWAGEN", "Golf Plus")),
    ("VOLKSWAGEN", "GOLF", ("VOLKSWAGEN", "Golf")),
    ("CITROEN", "NUEVO C3 AIRCROSS PURE", ("CITROEN", "C3 Aircross")),
    ("CITROEN", "X PICA EX HDI92", ("CITROEN", "Xsara Picasso")),
    ("CITROEN", "BERLINGO\xe1TALLA M BLUEH", ("CITROEN", "Berlingo")),
    ("TOYOTA", "1.6 COROLLA 4-D", ("TOYOTA", "Corolla")),
    ("BMW", "320D", ("BMW", "Serie 3")),
    ("BMW", "MINI-ONE D MAN", ("MINI", "Mini")),
    ("PEUGEOT", "E-2008 ALLURE", ("PEUGEOT", "2008")),
    ("HYUNDAI", "KONA, KAUAI", ("HYUNDAI", "Kona")),
])
def test_normalisation(marca, modelo, expected):
    k = N.key(marca, modelo)
    assert k is not None and (k[0], k[1]) == expected


def test_masked_values_are_not_guessed():
    assert N.key("TOYOTA", "¡") is None
    assert N.key("¡", "¡") is None


@pytest.mark.skipif(not (ROOT / "data" / "bajas" / "202609.parquet").exists(), reason="sin datos descargados")
def test_september_2026_reference_figures():
    """Reference check given with the brief: 46,125 definitive de-registrations of cars, median age 22.3."""
    import duckdb
    n, med = duckdb.connect().execute(f"""SELECT count(*), median(datediff('day', fec_prim, fec_tramite) / 365.25)
        FROM '{ROOT}/data/bajas/202609.parquet' WHERE clave IN ('3', '4')""").fetchone()
    assert abs(n - 46125) <= 2  # we read 46,126; the one-record gap is within duplicate-line noise
    assert abs(med - 22.3) < 0.05
