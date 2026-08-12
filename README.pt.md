# Scraper Challenge — Jurisprudência Peruana (PJ) e OEFA

Um **scraper em TypeScript** criado do zero (sem automação de navegador) para
o portal de jurisprudência do Poder Judicial do Peru e o repositório ambiental
da OEFA. Navega por todas as páginas de resultados de um site JSF/PrimeFaces,
extrai todos os dados de cada documento, baixa os PDFs associados com nomes
descritivos e trata **429 Too Many Requests** com backoff exponencial + jitter.

> **English:** [`README.md`](./README.md) · **Español:** [`README.es.md`](./README.es.md)

## Escopo do desafio

| Site | URL | Acesso |
|---|---|---|
| **Poder Judicial do Peru** (alvo principal) | `https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml` | Exige **VPN para o Peru** (bloqueio geográfico; HTTP 403 verificado de outras regiões) |
| **OEFA** (alvo de desenvolvimento/testes sem VPN) | `https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml` | Aberto |

Ambos são aplicações JSF. O projeto implementa um **motor JSF/PrimeFaces
genérico** (sessão, `javax.faces.ViewState`, POST completo e AJAX parcial
`<partial-response>`, paginação PrimeFaces) validado ao vivo contra a OEFA,
mais um **adaptador por site** que encapsula tudo que é específico (payloads,
seletores, descoberta de PDFs). O adaptador do PJ está implementado por
especificação a partir do padrão PrimeFaces verificado; só falta uma passada
de recon com VPN para confirmar os seletores (ver
[`docs/SITE_RECON.md`](./docs/SITE_RECON.md)).

## Requisitos

- Node.js ≥ 20 (testado no Node 20/22/24 via CI; localmente no Node 26)
- npm

> `tsx` é usado como runner de TypeScript em vez de `ts-node`: é nativo de ESM,
> mais rápido e sem configuração. O scraper em si usa apenas `axios` +
> `cheerio` para HTTP/parsing — sem automação de navegador.

## Instalação

```bash
git clone <url-do-repo> scraper-challenge
cd scraper-challenge
npm install
```

Copie o template de ambiente (todas as variáveis são opcionais):

```bash
cp .env.example .env
```

## Uso

```bash
npm run scrape -- --site oefa --limit 5 --lang pt       # metadados + PDFs, primeiros 5 documentos
npm run scrape -- --site oefa --no-pdfs --max-pages 2   # apenas metadados
npm run scrape -- --site pj  --lang pt --limit 5        # PJ (exige VPN para o Peru)
npm run scrape -- --site oefa --resume                  # continuar do checkpoint
npm run retry-failed -- --site oefa                     # reintentar PDFs com falha
npm run export-csv -- --site oefa                       # data/oefa/results.csv
npm run recon-pj -- --lang pt                      # checklist de recon do PJ (exige VPN)
```

### Opções da CLI

| Opção | Descrição |
|---|---|
| `--site <pj\|oefa>` | Site alvo (padrão: `oefa`) |
| `--lang <es\|pt\|en>` | Idioma das mensagens (padrão: `$SCRAPER_LANG` ou `es`) |
| `--expediente <texto>` | Filtrar por número de expediente |
| `--administrado <texto>` | Filtrar por administrado (OEFA) |
| `--unidad-fiscalizable <texto>` | Filtrar por unidade fiscalizável (OEFA) |
| `--sector <texto>` | Filtrar por setor (OEFA) |
| `--resolucion <texto>` | Filtrar por nº de resolução (OEFA) |
| `--materia <texto>` | Filtrar por matéria (PJ) |
| `--limit <n>` | Parar após `n` documentos |
| `--max-pages <n>` | Limitar páginas de resultados |
| `--delay-ms <n>` | Atraso entre requisições (padrão: 1500) |
| `--resume` | Continuar do último checkpoint |
| `--no-pdfs` | Apenas metadados, sem downloads |
| `--pdfs-dir <caminho>` | Diretório de saída dos PDFs |
| `--retry-failed` | Reintentar PDFs com falha (comando separado) |
| `--help` | Mostrar ajuda no idioma ativo |

### Variáveis de ambiente

| Variável | Finalidade | Padrão |
|---|---|---|
| `SCRAPER_LANG` | Idioma padrão (`es\|pt\|en`) | `es` |
| `SCRAPER_DELAY_MS` | Atraso entre requisições | `1500` |
| `SCRAPER_MAX_ATTEMPTS` | Tentativas máximas por requisição (429) | `5` |
| `SCRAPER_PROXY` | Proxy HTTP, ex.: túnel VPN local `http://127.0.0.1:3128` | vazio |
| `SCRAPER_DATA_DIR` | Diretório de saída | `data` |

## Saída

Tudo é gravado em `data/<site>/` (ignorado pelo git):

> Uma execução nova (sem `--resume`) começa com arquivos de saída vazios;
> `--resume` anexa aos resultados existentes e continua do checkpoint.

| Arquivo | Conteúdo |
|---|---|
| `results.jsonl` | Um documento JSON por registro, com todas as colunas em `raw` |
| `pdfs/*.pdf` | PDFs baixados com nomes descritivos (`<expediente>_<título>.pdf`) |
| `failed.jsonl` | PDFs que falharam após todas as tentativas (URL, erro, tentativas) |
| `results.csv` | Os mesmos registros em CSV (via `npm run export-csv -- --site <site>`) |
| `checkpoint.json` | Última página concluída — usada pelo `--resume` |

## Tratamento de 429

`src/core/retry.ts` envolve cada requisição (busca, paginação, download):

- Status reintentáveis: **429**, **503** e 403 com cabeçalho `Retry-After`.
- Backoff: `min(initialDelayMs · 2^n, maxDelayMs)` com jitter de ±25 %.
- Um `Retry-After` enviado pelo servidor vence sobre o atraso calculado.
- Após `SCRAPER_MAX_ATTEMPTS` falhas, o PDF é registrado em `failed.jsonl` e o
  scraper **continua com o próximo documento**.
- `npm run retry-failed -- --site <site>` reintenta as falhas registradas.

## Estrutura do projeto

```
src/
  core/       cliente HTTP + cookie jar, sessão JSF (ViewState, AJAX parcial),
              paginador PrimeFaces, retry 429, logger trilíngue
  extractors/ interface SiteAdapter + adaptador OEFA (verificado) + adaptador PJ (por especificação)
  pdf/        downloader (GET + POST JSF/Mojarra, validação de magic bytes %PDF) + nomes
  storage/    gravador JSONL, checkpoints, registros de PDFs falhos
  i18n/       dicionários de mensagens es / pt / en
  config/     configurações de ambiente + registro de sites
  main.ts     entrada da CLI (npm run scrape)
  retry-failed.ts  entrada da CLI (npm run retry-failed)
  scraper.ts  pipeline de extração
tests/
  fixtures/   HTML/XML reais capturados da OEFA + páginas de resultados fiéis à estrutura
  *.test.ts   testes unitários (sem rede) — com npm test
docs/
  SITE_RECON.md  notas de descoberta por site (ids de formulários, payloads, mecânica de PDFs)
```

## Como o motor JSF funciona

1. `GET` da página de busca → captura o cookie de sessão e o
   `javax.faces.ViewState`.
2. A busca é enviada como **POST AJAX parcial** do PrimeFaces
   (`Faces-Request: partial/ajax`) com os campos do formulário e o ViewState.
3. O XML `<partial-response>` é parseado (blocos `<update id="...">`) e o
   painel de resultados é extraído; o ViewState é atualizado pela resposta.
4. O paginador PrimeFaces é lido (`Página X de Y (N registros)`, estado
   desabilitado do próximo) e a paginação avança com os parâmetros
   `..._pagination`, `..._first`, `..._rows` até a última página. Uma guarda
   anti-loop interrompe a execução com um aviso se o servidor repetir a mesma
   página (observado no deployment da OEFA), de modo que execuções sem limite
   nunca ficam em loop nem duplicam documentos na retomada.
5. Para cada documento: o registro é persistido e seus PDFs são baixados.
   Os PDFs são links GET diretos ou **links de comando JSF/Mojarra** (um POST
   do formulário com os parâmetros do botão + `param_uuid` — a coluna
   "Archivo" da OEFA). O downloader reproduz o formulário com o estado de
   sessão vivo.
6. Todas as requisições obedecem ao atraso de cortesia e à política de 429.

## Testes

```bash
npm test        # 91 testes unitários, sem rede (fixtures)
npm run build   # compilação TypeScript estrita
```

CI (GitHub Actions) executa `npm ci` + `npm run build` + `npm test` no
Node.js 20/22/24 a cada push e pull request.

A integração contra o site OEFA ao vivo foi verificada de ponta a ponta
(busca → extração → POST Mojarra → PDFs reais baixados com magic bytes `%PDF`
validados). O site PJ exige VPN para o Peru; o adaptador usa o mesmo motor
verificado e só precisa confirmar os seletores com recon.

## Uso responsável

- Os portais são repositórios públicos do governo; o scraper adiciona atraso
  de cortesia configurável e backoff para não sobrecarregá-los.
- Execute um subconjunto pequeno (`--limit`) antes de execuções completas.
- Use VPN para o Peru no site PJ e não burle controles de acesso nem proteção
  contra limite de requisições.

## Licença

MIT
