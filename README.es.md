# Scraper Challenge — Jurisprudencia Peruana (PJ) y OEFA

Un **scraper en TypeScript** creado desde cero (sin automatización de
navegador) para el portal de jurisprudencia del Poder Judicial del Perú y el
repositorio ambiental de la OEFA. Navega todas las páginas de resultados de un
sitio JSF/PrimeFaces, extrae todos los datos de cada documento, descarga los
PDF asociados con nombres descriptivos y maneja **429 Too Many Requests** con
backoff exponencial + jitter.

> **English:** [`README.md`](./README.md) · **Português:** [`README.pt.md`](./README.pt.md)

## Alcance del desafío

| Sitio | URL | Acceso |
|---|---|---|
| **Poder Judicial del Perú** (objetivo principal) | `https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml` | Requiere **VPN a Perú** (bloqueo geográfico; verificado HTTP 403 desde otras regiones) |
| **OEFA** (objetivo de desarrollo/pruebas sin VPN) | `https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml` | Abierto |

Ambos son aplicaciones JSF. El proyecto implementa un **motor JSF/PrimeFaces
genérico** (sesión, `javax.faces.ViewState`, POST completos y AJAX parcial
`<partial-response>`, paginación PrimeFaces) validado en vivo contra la OEFA,
más un **adaptador por sitio** que encapsula todo lo específico (payloads,
selectores, descubrimiento de PDFs). El adaptador del PJ está implementado por
especificación a partir del patrón PrimeFaces verificado; solo falta una
pasada de recon con VPN para confirmar sus selectores (ver
[`docs/SITE_RECON.md`](./docs/SITE_RECON.md)).

## Requisitos

- Node.js ≥ 20 (probado en Node 20/22/24 vía CI; localmente en Node 26)
- npm

> `tsx` se usa como ejecutor de TypeScript en lugar de `ts-node`: es nativo de
> ESM, más rápido y sin configuración. El scraper en sí usa solo `axios` +
> `cheerio` para HTTP/parsing — sin automatización de navegador.

## Instalación

```bash
git clone <url-del-repo> scraper-challenge
cd scraper-challenge
npm install
```

Copie la plantilla de entorno (todas las variables son opcionales):

```bash
cp .env.example .env
```

## Uso

```bash
npm run scrape -- --site oefa --limit 5 --lang es       # metadatos + PDFs, primeros 5 documentos
npm run scrape -- --site oefa --no-pdfs --max-pages 2   # solo metadatos
npm run scrape -- --site pj  --lang es --limit 5        # PJ (requiere VPN a Perú)
npm run scrape -- --site oefa --resume                  # continuar desde el checkpoint
npm run retry-failed -- --site oefa                     # reintentar PDFs fallidos
npm run export-csv -- --site oefa                       # data/oefa/results.csv
npm run recon-pj -- --lang es                      # checklist de recon del PJ (requiere VPN)
```

### Opciones de la CLI

| Opción | Descripción |
|---|---|
| `--site <pj\|oefa>` | Sitio objetivo (por defecto: `oefa`) |
| `--lang <es\|pt\|en>` | Idioma de los mensajes (por defecto: `$SCRAPER_LANG` o `es`) |
| `--expediente <texto>` | Filtrar por número de expediente |
| `--administrado <texto>` | Filtrar por administrado (OEFA) |
| `--unidad-fiscalizable <texto>` | Filtrar por unidad fiscalizable (OEFA) |
| `--sector <texto>` | Filtrar por sector (OEFA) |
| `--resolucion <texto>` | Filtrar por Nº de resolución (OEFA) |
| `--materia <texto>` | Filtrar por materia (PJ) |
| `--limit <n>` | Detenerse tras `n` documentos |
| `--max-pages <n>` | Limitar páginas de resultados |
| `--delay-ms <n>` | Retraso entre peticiones (por defecto: 1500) |
| `--resume` | Continuar desde el último checkpoint |
| `--no-pdfs` | Solo metadatos, sin descargas |
| `--pdfs-dir <ruta>` | Directorio de salida de PDFs |
| `--retry-failed` | Reintentar PDFs fallidos (comando aparte) |
| `--help` | Mostrar ayuda en el idioma activo |

### Variables de entorno

| Variable | Propósito | Por defecto |
|---|---|---|
| `SCRAPER_LANG` | Idioma por defecto (`es\|pt\|en`) | `es` |
| `SCRAPER_DELAY_MS` | Retraso entre peticiones | `1500` |
| `SCRAPER_MAX_ATTEMPTS` | Intentos máximos por petición (429) | `5` |
| `SCRAPER_PROXY` | Proxy HTTP, p. ej. túnel VPN local `http://127.0.0.1:3128` | sin valor |
| `SCRAPER_DATA_DIR` | Directorio de salida | `data` |

## Salida

Todo se escribe en `data/<sitio>/` (ignorado por git):

> Una ejecución nueva (sin `--resume`) empieza con archivos de salida vacíos;
> `--resume` añade a los resultados existentes y continúa desde el checkpoint.

| Archivo | Contenido |
|---|---|
| `results.jsonl` | Un documento JSON por registro, con todas las columnas en `raw` |
| `pdfs/*.pdf` | PDFs descargados con nombres descriptivos (`<expediente>_<título>.pdf`) |
| `failed.jsonl` | PDFs que fallaron tras todos los reintentos (URL, error, intentos) |
| `results.csv` | Los mismos registros en CSV (vía `npm run export-csv -- --site <sitio>`) |
| `checkpoint.json` | Última página completada — usada por `--resume` |

## Manejo de 429

`src/core/retry.ts` envuelve cada petición (búsqueda, paginación, descarga):

- Estados reintentables: **429**, **503** y 403 con cabecera `Retry-After`.
- Backoff: `min(initialDelayMs · 2^n, maxDelayMs)` con jitter ±25 %.
- Un `Retry-After` enviado por el servidor gana sobre el retraso calculado.
- Tras `SCRAPER_MAX_ATTEMPTS` fallos el PDF se registra en `failed.jsonl` y el
  scraper **continúa con el siguiente documento**.
- `npm run retry-failed -- --site <sitio>` reintenta los fallos registrados.

## Estructura del proyecto

```
src/
  core/       cliente HTTP + cookie jar, sesión JSF (ViewState, AJAX parcial),
              paginador PrimeFaces, reintentos 429, logger trilingüe
  extractors/ interfaz SiteAdapter + adaptador OEFA (verificado) + adaptador PJ (por especificación)
  pdf/        descargador (GET + POST JSF/Mojarra, validación de magic bytes %PDF) + nombres
  storage/    escritor JSONL, checkpoints, registros de PDFs fallidos
  i18n/       diccionarios de mensajes es / pt / en
  config/     ajustes de entorno + registro de sitios
  main.ts     entrada de la CLI (npm run scrape)
  retry-failed.ts  entrada de la CLI (npm run retry-failed)
  scraper.ts  pipeline de extracción
tests/
  fixtures/   HTML/XML reales capturados de la OEFA + páginas de resultados fieles
  *.test.ts   pruebas unitarias (sin red) — con npm test
docs/
  SITE_RECON.md  notas de descubrimiento por sitio (ids de formularios, payloads, mecánica de PDFs)
```

## Cómo funciona el motor JSF

1. `GET` de la página de búsqueda → captura la cookie de sesión y el
   `javax.faces.ViewState`.
2. La búsqueda se envía como **POST AJAX parcial** de PrimeFaces
   (`Faces-Request: partial/ajax`) con los campos del formulario y el ViewState.
3. Se parsea el XML `<partial-response>` (bloques `<update id="...">`) y se
   toma el panel de resultados; el ViewState se refresca desde la respuesta.
4. Se lee el paginador PrimeFaces (`Página X de Y (N registros)`, estado
   deshabilitado del enlace siguiente) y se avanza con los parámetros
   `..._pagination`, `..._first`, `..._rows` hasta la última página. Una
   guarda anti-bucle detiene la ejecución con un aviso si el servidor repite
   la misma página (observado en el despliegue de la OEFA), de modo que las
   ejecuciones sin límite nunca pueden quedar en bucle ni duplicar documentos
   al reanudar.
5. Por cada documento: se persiste el registro y se descargan sus PDFs.
   Los PDFs son enlaces GET directos o **enlaces de comando JSF/Mojarra** (un
   POST del formulario con los parámetros del botón + `param_uuid` — la
   columna "Archivo" de la OEFA). El descargador reproduce el formulario con
   el estado de sesión vivo.
6. Todas las peticiones cumplen el retraso de cortesía y la política de 429.

## Pruebas

```bash
npm test        # 91 pruebas unitarias, sin red (fixtures)
npm run build   # compilación TypeScript estricta
```

CI (GitHub Actions) ejecuta `npm ci` + `npm run build` + `npm test` en
Node.js 20/22/24 en cada push y pull request.

La integración contra la OEFA en vivo se verificó de punta a punta (búsqueda →
extracción → POST Mojarra → PDFs reales descargados con bytes mágicos `%PDF`
validados). El sitio PJ requiere VPN a Perú; el adaptador usa el mismo motor
verificado y solo necesita confirmar sus selectores con recon.

## Uso responsable

- Los portales son repositorios públicos del gobierno; el scraper añade un
  retraso de cortesía configurable y backoff para no sobrecargarlos.
- Ejecute un subconjunto pequeño (`--limit`) antes de ejecuciones completas.
- Use VPN a Perú para el PJ y no eluda controles de acceso ni protección
  contra límites de peticiones.

## Licencia

MIT
