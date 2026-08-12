# Site Recon Notes

Discovery notes for each target site. Anything marked **HYPOTHESIS** was
inferred from the verified PrimeFaces pattern and still needs confirmation
with a live session.

---

## OEFA — `publico.oefa.gob.pe` (VERIFIED live, 2026-08-12)

**Page:** `GET /repdig/consulta/consultaTfa.xhtml` → HTTP 200, JSF + PrimeFaces 6.0,
charset UTF-8, locale `es`.

### Search form

- Form id: `listarDetalleInfraccionRAAForm`
- Action: `/repdig/consulta/consultaTfa.xhtml;jsessionid=<ID>` — the session id
  appears **both** in the URL and the `JSESSIONID` cookie (`Path=/repdig/;
  Secure; HttpOnly`); the client must handle both (cookie jar does).
- Fields:
  - `listarDetalleInfraccionRAAForm:txtNroexp` — Número de expediente
  - `listarDetalleInfraccionRAAForm:j_idt21` — Administrado
  - `listarDetalleInfraccionRAAForm:j_idt25` — Unidad fiscalizable
  - `listarDetalleInfraccionRAAForm:idsector` — Sector (`1` MINERIA, `2` ELECTRICIDAD,
    `3` HIDROCARBUROS, `8` PESQUERIA, `9` INDUSTRIA)
  - `listarDetalleInfraccionRAAForm:j_idt34` — Nro. Resolución de Apelación
- Button: `listarDetalleInfraccionRAAForm:btnBuscar` →
  `PrimeFaces.ab({s:"...:btnBuscar", u:"...:pgLista ...:txtNroexp"})` (partial AJAX).

### Search POST (partial AJAX)

```
POST <action>  (Faces-Request: partial/ajax, X-Requested-With: XMLHttpRequest)
  javax.faces.partial.ajax=true
  javax.faces.source=listarDetalleInfraccionRAAForm:btnBuscar
  javax.faces.partial.execute=@all
  javax.faces.partial.render=listarDetalleInfraccionRAAForm:pgLista listarDetalleInfraccionRAAForm:txtNroexp
  listarDetalleInfraccionRAAForm:btnBuscar=btnBuscar
  ...form fields...
  listarDetalleInfraccionRAAForm:dt_scrollState=<value from page hidden field>
  javax.faces.ViewState=<value>
```

Response: XML `<partial-response><changes><update id="...">…</update>…</changes></partial-response>`.
The new ViewState comes as an update whose id contains `javax.faces.ViewState`
(e.g. `j_id1:javax.faces.ViewState:0`) whose body is **plain text** (not an
`<input>`).

### Results table

- Panel: `listarDetalleInfraccionRAAForm:pgLista`; DataTable `...:dt`
  (rows in `...:dt_data`, header in `...:dt_head`).
- Columns: `Nro.`, `Número de expediente`, `Administrado`, `Unidad fiscalizable`,
  `Sector`, `Nro. Resolución de Apelación`, `Archivo`.
- Paginator: `...:dt_paginator_bottom`, label `Página X de Y (N registros)`
  (template: `Página {currentPage} de {totalPages} ({totalRecords} registros)`),
  links `ui-paginator-first/prev/next/last` with `ui-state-disabled` at the ends.
- Pagination POST (partial AJAX, source `...:dt`):
  `...:dt_pagination=true`, `...:dt_first=<firstRow>`, `...:dt_rows=10`.

### PDF mechanism — **Mojarra command link** (form POST)

The `Archivo` column renders (no direct href):

```html
<a href="#" onclick="mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm'),
  {'listarDetalleInfraccionRAAForm:dt:0:j_idt63':'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
   'param_uuid':'153a6d2a-cbed-40ef-b8ef-cd2272b19867'},'');return false">
  <img src="../images/pdf_descarga.png"></a>
```

Download = **full form POST** to the action URL with: all form fields, the
current ViewState, the command-button param and `param_uuid`. Verified live:
returns the real PDF (`application/pdf`, `%PDF-` magic bytes, multi-MB files).

### Observed quirks

- The backend behaves inconsistently between sessions (sometimes returns
  records for an empty search, sometimes 0). The scraper flow itself is
  consistent (verified multiple times); curl-based replication of the exact
  same flow returned 0 — treat "0 registros" as a valid, possible outcome and
  rely on `--expediente`/`--sector` filters for targeted runs.
- **Pagination is inert in this deployment** (verified live, 2026-08-12): a
  PrimeFaces 6-accurate pagination POST (`...:dt_pagination=true`,
  `...:dt_first=10`, `...:dt_rows=10`, source/process/update = `...:dt` — the
  exact wire format from PrimeFaces 6.0's own `DataTable.paginate()`) returns
  **page 1 again** ("Página 1 de 176 (1753 registros)") no matter the
  `first` value or execute variant. The scraper therefore stops after the
  first page on OEFA with a `paginateNoProgress` warning (the anti-loop
  guard), instead of looping forever. The PJ adapter uses the same engine and
  may paginate correctly — confirm during the PJ recon pass.
- `parseResults` must tolerate the empty-message row
  (`tr.ui-datatable-empty-message`).

---

## PJ — `jurisprudencia.pj.gob.pe` (REQUIRES VPN to Peru)

**Fastest path:** with the VPN on, run `npm run recon-pj -- --lang pt` — it
performs the whole checklist below automatically (reachability, form id,
hidden fields, AJAX wiring, datatable ids, live search probe) and flags which
HYPOTHESIS values in `src/extractors/pj.ts` need updating.

**Status:** geo-blocked from non-Peruvian IPs (verified HTTP 403 from this
machine). The adapter in `src/extractors/pj.ts` follows the PrimeFaces pattern
verified on OEFA. The items below are **HYPOTHESES** to confirm in recon with
VPN:

| Item | Current value | Confirm |
|---|---|---|
| Page | `GET /jurisprudenciaweb/faces/page/resultado.xhtml` | form id / ViewState |
| Form id | discovered dynamically from the page (`JsfSession.parsePage`) | — |
| Search button | `btnBuscar` (without form prefix) | exact id |
| Search field | `txtBusqueda` (expediente / free text) | exact id + semantics |
| Render target | `pgLista` | exact panel id |
| DataTable | `dtResultado` (`...:dtResultado_data`, `..._head`) | exact ids |
| PDFs | unknown — likely a detail/command link or direct servlet URL | inspect the
  result rows (DevTools Network tab) |

### Recon checklist (with VPN)

1. `curl -v https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml`
   → save HTML; extract form id, action URL, `javax.faces.ViewState`.
2. Trigger a search in a browser (DevTools → Network) and capture the POST
   (partial AJAX or full POST?), params and headers.
3. Inspect the results table: ids, columns, paginator shape.
4. Click a document's PDF/download and capture how the file is served
   (direct URL, servlet with params, session cookie, form POST).
5. Update `src/extractors/pj.ts` (selectors/payloads) and `tests/fixtures/pj-*`,
   then verify: `npm run scrape -- --site pj --no-pdfs --limit 5`.
