<img src="assets/icon.svg" width="64" height="64" alt="">

# Cuánto dura

**¿Cuántos años dura de verdad cada coche en España?** Tablas de supervivencia por marca, modelo, motor,
combustible y provincia, calculadas con los microdatos públicos de bajas y parque de la DGT.

👉 **https://cuantodura.aminox.dev** · [English](https://cuantodura.aminox.dev/en/)

- Curva de supervivencia de cada modelo frente a la media y a sus rivales, con intervalos de confianza.
- Vida mediana, porcentaje que sigue dado de alta a los 10, 15, 20 y 25 años, e índice de bajas estandarizado por edad.
- Diésel frente a gasolina, cada motor, potencia y generación; motivos de baja y exportaciones aparte.
- Comparador de hasta cuatro modelos, «Tu coche» (probabilidad de seguir de alta dentro de 5 años), mapa por provincia y rankings.
- Se actualiza sola cada mes cuando la DGT publica datos nuevos.

Es **longevidad, no fiabilidad**: no hay kilómetros, una baja no siempre es una avería y el precio del coche influye
en cuánto merece la pena repararlo. Todo se explica en la [metodología](https://cuantodura.aminox.dev/metodologia/).

## Método en una línea

Tabla de vida de periodo, como en demografía: para cada grupo y edad, bajas definitivas (claves 3 y 4) de los últimos
12 meses entre el parque con esa edad a mitad del periodo; `q = m/(1+m/2)`, `S(x) = Π(1 − q)`. Intervalos de Greenwood
con transformación log(−log); índice de bajas = observadas / esperadas a las tasas nacionales por edad (×100).
Las exportaciones (clave 7) no cuentan como bajas y se muestran aparte.

## Estructura

```
pipeline/            Proceso de datos (Python + DuckDB)
  dgt_layout.py        Diseño de registro de ancho fijo de las bajas (MATRABA)
  ingest_bajas.py      Descarga mensual de bajas → data/bajas/AAAAMM.parquet (turismos, claves 3/4/7)
  ingest_parque.py     Parque mensual (1,7 GB) leído en streaming → agregado en data/parque/AAAAMM.parquet
  normalize.py         Normalización de marcas y modelos
  catalog/             Tablas de equivalencias revisables: marcas.csv, modelos.csv, reasignar.csv
  impute.py            Reparto de los modelos enmascarados por la DGT («¡») por celdas
  lifetable.py         Tabla de vida, Greenwood, mediana e índice estandarizado
  build.py             Calcula todo y escribe los JSON estáticos (public/data)
  validate.py          Compara con la versión publicada antes de desplegar
  update.sh            Actualización automática (descarga → cálculo → validación → despliegue)
src/                 Web en TypeScript sin framework (gráficas SVG propias)
scripts/prerender.ts Páginas estáticas por modelo, imágenes Open Graph, sitemap y robots
tests/               Tests de lectura (líneas reales), fórmulas (datos sintéticos) e i18n
deploy/              nginx del contenedor y unidades systemd del servidor
```

## Ejecutarlo

```bash
python3 -m venv .venv && .venv/bin/pip install duckdb pyarrow pytest
cd pipeline
../.venv/bin/python ingest_bajas.py --from 2015-01          # ~12 MB por mes
../.venv/bin/python ingest_parque.py 2026-04                # parque de mitad de periodo
../.venv/bin/python ingest_parque.py 2026-09                # parque más reciente
../.venv/bin/python build.py                                # → public/data
cd .. && npm install && npm run dev                         # http://localhost:5173
```

Tests: `.venv/bin/python -m pytest tests/py` y `npm test`.

Requisitos de memoria: la agregación del parque usa unos 2 GB de RAM y el cálculo completo, unos 4 GB. Los ZIP se leen
sin descomprimir y se borran al terminar; solo se guardan agregados (~130 MB).

## Datos y licencia

**Origen de los datos: Dirección General de Tráfico (DGT)**, microdatos MATRABA de bajas y fichero de parque mensual
([DGT en cifras](https://www.dgt.es/menusecundario/dgt-en-cifras/)), reutilizados conforme a la Ley 37/2007. La DGT no
participa ni patrocina este proyecto. Los límites provinciales son del IGN (CC BY 4.0) vía
[es-atlas](https://github.com/martgnz/es-atlas). Los nombres de marcas y modelos se usan solo para identificar los
vehículos; no hay logotipos ni relación con ningún fabricante.

Código con licencia [MIT](LICENSE). © 2026 Amin Tahtah Toumi.
