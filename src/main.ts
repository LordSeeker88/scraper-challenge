import { join } from 'node:path';
import { HttpClient } from './core/http-client.js';
import { Logger } from './core/logger.js';
import { normalizeLang, type Lang } from './i18n/index.js';
import { loadSettings } from './config/settings.js';
import { getSite } from './config/sites.js';
import { runScrape } from './scraper.js';
import { retryFailedPdfs } from './retry-failed.js';
import type { SearchQuery } from './extractors/types.js';

export interface CliOptions {
  site: string;
  lang?: string;
  query: SearchQuery;
  limit?: number;
  maxPages?: number;
  delayMs?: number;
  resume: boolean;
  retryFailed: boolean;
  pdfs: boolean;
  pdfsDir?: string;
  help: boolean;
}

const FLAGS_WITH_VALUE = new Set([
  '--site', '--lang', '--expediente', '--administrado', '--unidad-fiscalizable',
  '--sector', '--resolucion', '--materia', '--limit', '--max-pages', '--delay-ms', '--pdfs-dir',
]);

function parsePositiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} expects a positive integer, got: ${value}`);
  return n;
}

/** Parse CLI arguments into options (pure; unit-tested). */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    site: 'oefa',
    query: {},
    resume: false,
    retryFailed: false,
    pdfs: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--resume') { opts.resume = true; continue; }
    if (arg === '--retry-failed') { opts.retryFailed = true; continue; }
    if (arg === '--no-pdfs') { opts.pdfs = false; continue; }

    let value: string | undefined;
    if (FLAGS_WITH_VALUE.has(arg)) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }

    switch (arg) {
      case '--site': opts.site = value; break;
      case '--lang': opts.lang = value; break;
      case '--expediente': opts.query.expediente = value; break;
      case '--administrado': opts.query.administrado = value; break;
      case '--unidad-fiscalizable': opts.query.unidadFiscalizable = value; break;
      case '--sector': opts.query.sector = value; break;
      case '--resolucion': opts.query.resolucion = value; break;
      case '--materia': opts.query.materia = value; break;
      case '--limit': opts.limit = parsePositiveInt(value, arg); break;
      case '--max-pages': opts.maxPages = parsePositiveInt(value, arg); break;
      case '--delay-ms': opts.delayMs = parsePositiveInt(value, arg); break;
      case '--pdfs-dir': opts.pdfsDir = value; break;
      default: break;
    }
  }
  return opts;
}

function helpText(lang: Lang): string {
  const L = lang === 'pt'
    ? {
        usage: 'Uso:', cmd: 'npm run scrape -- [opções]',
        flags: [
          ['--site <pj|oefa>', 'Site alvo (padrão: oefa)'],
          ['--lang <es|pt|en>', 'Idioma das mensagens (padrão: $SCRAPER_LANG ou es)'],
          ['--expediente <texto>', 'Filtrar por número de expediente'],
          ['--administrado <texto>', 'Filtrar por administrado (OEFA)'],
          ['--unidad-fiscalizable <texto>', 'Filtrar por unidade fiscalizável (OEFA)'],
          ['--sector <texto>', 'Filtrar por setor (OEFA)'],
          ['--resolucion <texto>', 'Filtrar por nº de resolução (OEFA)'],
          ['--materia <texto>', 'Filtrar por matéria (PJ)'],
          ['--limit <n>', 'Parar após n documentos'],
          ['--max-pages <n>', 'Limitar número de páginas de resultados'],
          ['--delay-ms <n>', 'Atraso entre requisições em ms'],
          ['--resume', 'Retomar a partir do checkpoint'],
          ['--no-pdfs', 'Extrair apenas metadados (sem download)'],
          ['--pdfs-dir <caminho>', 'Diretório de saída dos PDFs'],
          ['--retry-failed', 'Reintentar PDFs falhos (comando separado)'],
          ['--help', 'Mostrar esta ajuda'],
        ],
        env: 'Variáveis de ambiente: SCRAPER_LANG, SCRAPER_DELAY_MS, SCRAPER_MAX_ATTEMPTS, SCRAPER_PROXY, SCRAPER_DATA_DIR',
        examples: [
          'Exemplos:',
          '  npm run scrape -- --site oefa --limit 5 --lang pt',
          '  npm run scrape -- --site oefa --no-pdfs --max-pages 2',
          '  npm run retry-failed -- --site oefa',
        ],
      }
    : lang === 'en'
      ? {
          usage: 'Usage:', cmd: 'npm run scrape -- [options]',
          flags: [
            ['--site <pj|oefa>', 'Target site (default: oefa)'],
            ['--lang <es|pt|en>', 'Message language (default: $SCRAPER_LANG or es)'],
            ['--expediente <text>', 'Filter by case/expediente number'],
            ['--administrado <text>', 'Filter by administrado (OEFA)'],
            ['--unidad-fiscalizable <text>', 'Filter by fiscalizable unit (OEFA)'],
            ['--sector <text>', 'Filter by sector (OEFA)'],
            ['--resolucion <text>', 'Filter by resolution number (OEFA)'],
            ['--materia <text>', 'Filter by subject matter (PJ)'],
            ['--limit <n>', 'Stop after n documents'],
            ['--max-pages <n>', 'Limit result pages'],
            ['--delay-ms <n>', 'Delay between requests, in ms'],
            ['--resume', 'Resume from checkpoint'],
            ['--no-pdfs', 'Metadata only (no downloads)'],
            ['--pdfs-dir <path>', 'PDF output directory'],
            ['--retry-failed', 'Retry failed PDFs (separate command)'],
            ['--help', 'Show this help'],
          ],
          env: 'Environment: SCRAPER_LANG, SCRAPER_DELAY_MS, SCRAPER_MAX_ATTEMPTS, SCRAPER_PROXY, SCRAPER_DATA_DIR',
          examples: [
            'Examples:',
            '  npm run scrape -- --site oefa --limit 5 --lang en',
            '  npm run scrape -- --site oefa --no-pdfs --max-pages 2',
            '  npm run retry-failed -- --site oefa',
          ],
        }
      : {
          usage: 'Uso:', cmd: 'npm run scrape -- [opciones]',
          flags: [
            ['--site <pj|oefa>', 'Sitio objetivo (por defecto: oefa)'],
            ['--lang <es|pt|en>', 'Idioma de los mensajes (por defecto: $SCRAPER_LANG o es)'],
            ['--expediente <texto>', 'Filtrar por número de expediente'],
            ['--administrado <texto>', 'Filtrar por administrado (OEFA)'],
            ['--unidad-fiscalizable <texto>', 'Filtrar por unidad fiscalizable (OEFA)'],
            ['--sector <texto>', 'Filtrar por sector (OEFA)'],
            ['--resolucion <texto>', 'Filtrar por Nº de resolución (OEFA)'],
            ['--materia <texto>', 'Filtrar por materia (PJ)'],
            ['--limit <n>', 'Detenerse tras n documentos'],
            ['--max-pages <n>', 'Limitar páginas de resultados'],
            ['--delay-ms <n>', 'Retraso entre peticiones, en ms'],
            ['--resume', 'Reanudar desde el checkpoint'],
            ['--no-pdfs', 'Solo metadatos (sin descargas)'],
            ['--pdfs-dir <ruta>', 'Directorio de salida de PDFs'],
            ['--retry-failed', 'Reintentar PDFs fallidos (comando aparte)'],
            ['--help', 'Mostrar esta ayuda'],
          ],
          env: 'Variables de entorno: SCRAPER_LANG, SCRAPER_DELAY_MS, SCRAPER_MAX_ATTEMPTS, SCRAPER_PROXY, SCRAPER_DATA_DIR',
          examples: [
            'Ejemplos:',
            '  npm run scrape -- --site oefa --limit 5 --lang es',
            '  npm run scrape -- --site oefa --no-pdfs --max-pages 2',
            '  npm run retry-failed -- --site oefa',
          ],
        };
  const lines = [
    `${L.usage} ${L.cmd}`,
    '',
    ...L.flags.map(([f, d]) => `  ${f.padEnd(28)} ${d}`),
    '',
    `  ${L.env}`,
    '',
    ...L.examples,
  ];
  return lines.join('\n');
}

export async function main(argv: string[]): Promise<number> {
  let cli: CliOptions;
  try {
    cli = parseArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const logger = new Logger('es');
    logger.error('error', { message: msg });
    logger.raw(helpText('es'));
    return 2;
  }

  const settings = loadSettings();
  const lang = normalizeLang(cli.lang ?? settings.lang);
  const logger = new Logger(lang);

  if (cli.help) {
    logger.raw(helpText(lang));
    return 0;
  }

  const adapter = getSite(cli.site);
  if (!adapter) {
    logger.error('siteUnknown', { site: cli.site });
    logger.raw(helpText(lang));
    return 1;
  }

  if (cli.retryFailed) {
    return runRetryFailed(cli, settings, logger, adapter.id);
  }

  if (adapter.requiresVpn) {
    logger.warn('siteRecon', { site: adapter.id });
  }

  const delayMs = cli.delayMs ?? settings.delayMs;
  const http = new HttpClient({ delayMs, proxy: settings.proxy });

  const dir = join(settings.dataDir, adapter.id);
  const pdfsDir = cli.pdfsDir ?? join(dir, 'pdfs');
  const referer = adapter.baseUrl + adapter.searchPagePath;

  logger.info('start');
  logger.info('pdfsDir', { dir: pdfsDir });

  const start = Date.now();
  const stats = await runScrape({
    site: adapter,
    http,
    logger,
    query: cli.query,
    limit: cli.limit,
    maxPages: cli.maxPages,
    pdfs: cli.pdfs,
    pdfsDir,
    resultsPath: join(dir, 'results.jsonl'),
    checkpointPath: join(dir, 'checkpoint.json'),
    failedPath: join(dir, 'failed.jsonl'),
    resume: cli.resume,
    maxAttempts: settings.maxAttempts,
    referer,
  });
  const seconds = Math.round((Date.now() - start) / 1000);

  logger.info('resultsWritten', { path: join(dir, 'results.jsonl') });
  logger.info('summary', { docs: stats.docs, pdfsOk: stats.pdfsOk, pdfsFailed: stats.pdfsFailed, seconds });
  logger.info('end');
  return 0;
}

function runRetryFailed(
  cli: CliOptions,
  settings: ReturnType<typeof loadSettings>,
  logger: Logger,
  siteId: string,
): Promise<number> {
  return retryFailedPdfs({
    siteId,
    lang: logger.lang,
    dataDir: settings.dataDir,
    pdfsDir: cli.pdfsDir,
    maxAttempts: settings.maxAttempts,
    delayMs: cli.delayMs ?? settings.delayMs,
    proxy: settings.proxy,
  }).then(() => 0).catch((err) => {
    logger.error('error', { message: err instanceof Error ? err.message : String(err) });
    return 1;
  });
}

// ---------------------------------------------------------------------------
// Ponto de entrada da CLI: `npm run scrape -- [opcoes]`
// ---------------------------------------------------------------------------
const isDirectRun = process.argv[1]
  ? /main\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/'))
  : false;

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
