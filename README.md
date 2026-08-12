# Scraper Challenge — Peruvian Jurisprudence (PJ) & OEFA

[![CI](https://github.com/LordSeeker88/scraper-challenge/actions/workflows/ci.yml/badge.svg)](https://github.com/LordSeeker88/scraper-challenge/actions/workflows/ci.yml)

A from-scratch **TypeScript scraper** (no browser automation) for the
Peruvian Judiciary's jurisprudence portal and the OEFA environmental
repository. It navigates every result page of a JSF/PrimeFaces site,
extracts every field of every document, downloads the associated PDFs with
descriptive filenames, and handles **429 Too Many Requests** with
exponential backoff + jitter.

> **Español:** [`README.es.md`](./README.es.md) · **Português:** [`README.pt.md`](./README.pt.md)

## Challenge scope

| Site | URL | Access |
|---|---|---|
| **Poder Judicial del Perú** (main target) | `https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml` | Requires a **VPN to Peru** (geo-blocked; verified HTTP 403 from other regions) |
| **OEFA** (development / no-VPN test target) | `https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml` | Open |

Both are JSF applications. This project implements a **generic JSF/PrimeFaces
engine** (session, `javax.faces.ViewState`, full POSTs and partial AJAX
`<partial-response>` parsing, PrimeFaces pagination) validated live against
OEFA, plus a **per-site adapter** that encapsulates everything site-specific
(payloads, selectors, PDF discovery). The PJ adapter is implemented by
specification from the verified PrimeFaces pattern; only a recon pass with VPN
is needed to confirm its selectors (see [`docs/SITE_RECON.md`](./docs/SITE_RECON.md)).

## Requirements

- Node.js ≥ 20 (tested on Node 20/22/24 via CI; locally on Node 26)
- npm

> `tsx` is used as the TypeScript runner instead of `ts-node`: it is
> ESM-native, faster, and needs no configuration. The scraper itself uses
> only `axios` + `cheerio` for HTTP/parsing — no browser automation.

## Installation

```bash
git clone <repo-url> scraper-challenge
cd scraper-challenge
npm install
```

Copy the environment template (all variables are optional):

```bash
cp .env.example .env
```

## Usage

```bash
npm run scrape -- --site oefa --limit 5 --lang en      # metadata + PDFs, first 5 documents
npm run scrape -- --site oefa --no-pdfs --max-pages 2  # metadata only
npm run scrape -- --site pj  --lang es --limit 5       # PJ (requires VPN to Peru)
npm run scrape -- --site oefa --resume                 # continue from checkpoint
npm run retry-failed -- --site oefa                    # re-download PDFs recorded as failed
npm run export-csv -- --site oefa                      # data/oefa/results.csv
npm run recon-pj -- --lang pt                      # PJ recon checklist (requires VPN)
```

### CLI options

| Flag | Description |
|---|---|
| `--site <pj\|oefa>` | Target site (default: `oefa`) |
| `--lang <es\|pt\|en>` | Message language (default: `$SCRAPER_LANG` or `es`) |
| `--expediente <text>` | Filter by case/expediente number |
| `--administrado <text>` | Filter by administrado (OEFA) |
| `--unidad-fiscalizable <text>` | Filter by fiscalizable unit (OEFA) |
| `--sector <text>` | Filter by sector (OEFA) |
| `--resolucion <text>` | Filter by resolution number (OEFA) |
| `--materia <text>` | Filter by subject matter (PJ) |
| `--limit <n>` | Stop after `n` documents |
| `--max-pages <n>` | Limit the number of result pages |
| `--delay-ms <n>` | Politeness delay between requests (default: 1500) |
| `--resume` | Resume from the last checkpoint |
| `--no-pdfs` | Extract metadata only, skip downloads |
| `--pdfs-dir <path>` | PDF output directory |
| `--retry-failed` | Retry failed PDFs (separate command) |
| `--help` | Show help in the active language |

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `SCRAPER_LANG` | Default message language (`es\|pt\|en`) | `es` |
| `SCRAPER_DELAY_MS` | Delay between requests | `1500` |
| `SCRAPER_MAX_ATTEMPTS` | Max attempts per request (429 handling) | `5` |
| `SCRAPER_PROXY` | HTTP proxy, e.g. a local VPN tunnel `http://127.0.0.1:3128` | unset |
| `SCRAPER_DATA_DIR` | Output directory | `data` |

## Output

Everything is written under `data/<site>/` (gitignored):

> A fresh run (no `--resume`) starts from empty output files; `--resume`
> appends to the existing results and continues from the checkpoint.

| File | Contents |
|---|---|
| `results.jsonl` | One JSON document per record, with every column in `raw` |
| `pdfs/*.pdf` | Downloaded PDFs with descriptive names (`<expediente>_<title>.pdf`) |
| `failed.jsonl` | PDFs that failed after all retries (URL, error, attempts) |
| `results.csv` | Same records as CSV (via `npm run export-csv -- --site <site>`) |
| `checkpoint.json` | Last completed page — used by `--resume` |

Example record:

```json
{
  "id": "00123-2019-OEFA/DFSAI_0",
  "source": "oefa",
  "expediente": "00123-2019-OEFA/DFSAI",
  "title": "MINERA SANTA ROSA S.A.C.",
  "raw": {
    "Nro.": "1",
    "Número de expediente": "00123-2019-OEFA/DFSAI",
    "Administrado": "MINERA SANTA ROSA S.A.C.",
    "Sector": "MINERIA",
    "Nro. Resolución de Apelación": "Nº 045-2022-OEFA/TFA",
    "Archivo": ""
  },
  "pdfs": [{ "method": "POST", "form": { "...:dt:0:j_idt63": "...", "param_uuid": "..." } }],
  "crawledAt": "2026-08-12T20:03:13.000Z"
}
```

## 429 handling

`src/core/retry.ts` wraps every request (search, pagination, PDF download):

- Retryable statuses: **429**, **503**, and 403 with a `Retry-After` header.
- Backoff: `min(initialDelayMs · 2^n, maxDelayMs)` with ±25% jitter.
- A server-sent `Retry-After` wins over the computed delay.
- After `SCRAPER_MAX_ATTEMPTS` failures the PDF is recorded in `failed.jsonl`
  and the scraper **continues with the next document**.
- Re-run with `npm run retry-failed -- --site <site>` to retry recorded failures.

## Project structure

```
src/
  core/       http client + cookie jar, JSF session (ViewState, partial AJAX),
              PrimeFaces paginator, 429 retry, trilingual logger
  extractors/ SiteAdapter interface + OEFA adapter (verified) + PJ adapter (by spec)
  pdf/        downloader (GET + JSF/Mojarra POST, %PDF magic-byte validation) + naming
  storage/    JSONL writer, checkpoints, failed-PDF records
  i18n/       es / pt / en message dictionaries
  config/     env settings + site registry
  main.ts     CLI entry (npm run scrape)
  retry-failed.ts  CLI entry (npm run retry-failed)
  scraper.ts  extraction pipeline
tests/
  fixtures/   real captured OEFA HTML/XML + structure-faithful result pages
  *.test.ts   unit tests (network-free) — run with npm test
docs/
  SITE_RECON.md  site-by-site discovery notes (form ids, payloads, PDF mechanics)
```

## How the JSF engine works

1. `GET` the search page → capture the session cookie and `javax.faces.ViewState`.
2. Submit the search as a PrimeFaces **partial AJAX POST**
   (`Faces-Request: partial/ajax`) with the form fields and the ViewState.
3. Parse the `<partial-response>` XML (`<update id="...">` blocks) and pick the
   results panel; refresh the ViewState from the response.
4. Read the PrimeFaces paginator (`Página X de Y (N registros)`, next-link
   disabled state) and page forward with `..._pagination`, `..._first`,
   `..._rows` params until the last page. An anti-loop guard stops the run
   with a warning if a server keeps returning the same page (observed on the
   OEFA deployment), so unbounded runs can never loop forever or duplicate
   documents on resume.
5. For each document: persist the record, then download its PDFs.
   PDFs are either plain GET links or **JSF/Mojarra command links** (a form
   POST with the command-button params + `param_uuid` — the OEFA "Archivo"
   column). The downloader replays the form with the live session state.
6. All requests run under the politeness delay + 429 retry policy.

## Tests

```bash
npm test        # 91 unit tests, network-free (fixtures)
npm run build   # strict TypeScript build
```

CI (GitHub Actions) runs `npm ci` + `npm run build` + `npm test` on
Node.js 20/22/24 for every push and pull request.

Integration against the live OEFA site was verified end-to-end (search →
extraction → Mojarra POST → real PDFs downloaded with `%PDF` magic bytes
validated). The PJ site requires VPN to Peru; the adapter follows the same
verified engine and needs only a recon confirmation of its selectors.

## Responsible use

- The portals are public government repositories; the scraper adds a
  configurable politeness delay and retry backoff to avoid overloading them.
- Run a small subset (`--limit`) before full runs.
- Use a VPN to Peru for the PJ site, and do not bypass access controls or
  rate-limit protection.

## License

MIT
