"""Spanish provinces: INE code, DGT plate-letter code (bajas file) and display name."""
from __future__ import annotations

# ine, letters, name
PROVINCES: list[tuple[str, str, str]] = [
    ("01", "VI", "Álava"), ("02", "AB", "Albacete"), ("03", "A", "Alicante"), ("04", "AL", "Almería"),
    ("05", "AV", "Ávila"), ("06", "BA", "Badajoz"), ("07", "IB", "Illes Balears"), ("08", "B", "Barcelona"),
    ("09", "BU", "Burgos"), ("10", "CC", "Cáceres"), ("11", "CA", "Cádiz"), ("12", "CS", "Castellón"),
    ("13", "CR", "Ciudad Real"), ("14", "CO", "Córdoba"), ("15", "C", "A Coruña"), ("16", "CU", "Cuenca"),
    ("17", "GI", "Girona"), ("18", "GR", "Granada"), ("19", "GU", "Guadalajara"), ("20", "SS", "Gipuzkoa"),
    ("21", "H", "Huelva"), ("22", "HU", "Huesca"), ("23", "J", "Jaén"), ("24", "LE", "León"),
    ("25", "L", "Lleida"), ("26", "LO", "La Rioja"), ("27", "LU", "Lugo"), ("28", "M", "Madrid"),
    ("29", "MA", "Málaga"), ("30", "MU", "Murcia"), ("31", "NA", "Navarra"), ("32", "OU", "Ourense"),
    ("33", "O", "Asturias"), ("34", "P", "Palencia"), ("35", "GC", "Las Palmas"), ("36", "PO", "Pontevedra"),
    ("37", "SA", "Salamanca"), ("38", "TF", "Santa Cruz de Tenerife"), ("39", "S", "Cantabria"),
    ("40", "SG", "Segovia"), ("41", "SE", "Sevilla"), ("42", "SO", "Soria"), ("43", "T", "Tarragona"),
    ("44", "TE", "Teruel"), ("45", "TO", "Toledo"), ("46", "V", "Valencia"), ("47", "VA", "Valladolid"),
    ("48", "BI", "Bizkaia"), ("49", "ZA", "Zamora"), ("50", "Z", "Zaragoza"), ("51", "CE", "Ceuta"),
    ("52", "ML", "Melilla"),
]
LETTER_TO_INE = {l: i for i, l, _ in PROVINCES} | {"PM": "07", "LR": "26", "OR": "32", "GE": "17", "ME": "52"}
NAME = {i: n for i, _, n in PROVINCES}
