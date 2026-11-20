"""Fixed-width layout of the DGT monthly 'bajas' microdata file (MATRABA).

Source: BAJAS_MATRABA.pdf (DGT, «Interfaz de envío de datos»). Text is latin-1.
Only the first fields we need are listed by name; widths of the leading fields
are cumulative, so every field up to the last one we read must be present.
"""
from __future__ import annotations

from datetime import date

# (name, width) in file order, fields 1..55 of the PDF.
FIELDS: list[tuple[str, int]] = [
    ("FEC_MATRICULA", 8), ("COD_CLASE_MAT", 1), ("FEC_TRAMITACION", 8), ("MARCA_ITV", 30),
    ("MODELO_ITV", 22), ("COD_PROCEDENCIA_ITV", 1), ("BASTIDOR_ITV", 21), ("COD_TIPO", 2),
    ("COD_PROPULSION_ITV", 1), ("CILINDRADA_ITV", 5), ("POTENCIA_ITV", 6), ("TARA", 6),
    ("PESO_MAX", 6), ("NUM_PLAZAS_ITV", 3), ("IND_PRECINTO", 2), ("IND_EMBARGO", 2),
    ("NUM_TRANSMISIONES", 2), ("NUM_TITULARES", 2), ("LOCALIDAD_VEHICULO", 24),
    ("COD_PROVINCIA_VEH", 2), ("COD_PROVINCIA_MAT", 2), ("CLAVE_TRAMITE", 1), ("FEC_TRAMITE", 8),
    ("CODIGO_POSTAL", 5), ("FEC_PRIM_MATRICULACION", 8), ("IND_NUEVO_USADO", 1),
    ("PERSONA_FISICA_JURIDICA", 1), ("CODIGO_ITV", 9), ("SERVICIO", 3), ("COD_MUNICIPIO_INE_VEH", 5),
    ("MUNICIPIO", 30), ("KW_ITV", 7), ("NUM_PLAZAS_MAX", 3), ("CO2_ITV", 5), ("RENTING", 1),
    ("COD_TUTELA", 1), ("COD_POSESION", 1), ("IND_BAJA_DEF", 1), ("IND_BAJA_TEMP", 1),
    ("IND_SUSTRACCION", 1), ("BAJA_TELEMATICA", 11), ("TIPO_ITV", 25), ("VARIANTE_ITV", 25),
    ("VERSION_ITV", 35), ("FABRICANTE_ITV", 70), ("MASA_ORDEN_MARCHA", 6), ("MASA_MAX_TECNICA", 6),
    ("CATEGORIA_HOMOLOGACION", 4), ("CARROCERIA", 4), ("PLAZAS_PIE", 3), ("NIVEL_EMISIONES_EURO", 8),
    ("CONSUMO_WH_KM", 4), ("CLASIFICACION_REGLAMENTO", 4), ("CATEGORIA_ELECTRICO", 4),
]

SLICES: dict[str, slice] = {}
_pos = 0
for _name, _w in FIELDS:
    SLICES[_name] = slice(_pos, _pos + _w)
    _pos += _w
RECORD_MIN = _pos

WANTED = (
    "FEC_MATRICULA", "MARCA_ITV", "MODELO_ITV", "COD_TIPO", "COD_PROPULSION_ITV", "CILINDRADA_ITV",
    "NUM_TITULARES", "COD_PROVINCIA_VEH", "CLAVE_TRAMITE", "FEC_TRAMITE", "FEC_PRIM_MATRICULACION",
    "KW_ITV", "IND_BAJA_DEF", "CATEGORIA_ELECTRICO", "SERVICIO",
)


def ddmmyyyy(s: str) -> date | None:
    s = s.strip()
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[4:]), int(s[2:4]), int(s[:2]))
    except ValueError:
        return None


def to_float(s: str) -> float | None:
    s = s.strip().replace(",", ".")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def parse_line(line: str) -> dict:
    """Parse one decoded line into the fields we use. Missing first registration → FEC_MATRICULA."""
    r = {k: line[SLICES[k]].strip() for k in WANTED}
    fm = ddmmyyyy(r["FEC_MATRICULA"])
    fp = ddmmyyyy(r["FEC_PRIM_MATRICULACION"]) or fm
    return {
        "fec_matricula": fm,
        "fec_prim": fp,
        "fec_tramite": ddmmyyyy(r["FEC_TRAMITE"]),
        "marca": r["MARCA_ITV"],
        "modelo": r["MODELO_ITV"],
        "cod_tipo": r["COD_TIPO"],
        "propulsion": r["COD_PROPULSION_ITV"],
        "cilindrada": to_float(r["CILINDRADA_ITV"]),
        "kw": to_float(r["KW_ITV"]),
        "titulares": int(r["NUM_TITULARES"]) if r["NUM_TITULARES"].isdigit() else None,
        "provincia": r["COD_PROVINCIA_VEH"],
        "clave": r["CLAVE_TRAMITE"],
        "motivo": r["IND_BAJA_DEF"],
        "cat_elec": r["CATEGORIA_ELECTRICO"],
        "servicio": r["SERVICIO"],
    }
