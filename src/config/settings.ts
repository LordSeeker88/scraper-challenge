import type { Lang } from '../i18n/index.js';
import { normalizeLang } from '../i18n/index.js';

export interface Settings {
  lang: Lang;
  delayMs: number;
  maxAttempts: number;
  proxy?: string;
  dataDir: string;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    lang: normalizeLang(env.SCRAPER_LANG),
    delayMs: num(env.SCRAPER_DELAY_MS, 1500),
    // At least 1 attempt: 0 would make every request fail immediately.
    maxAttempts: Math.max(1, Math.round(num(env.SCRAPER_MAX_ATTEMPTS, 5))),
    proxy: env.SCRAPER_PROXY || undefined,
    dataDir: env.SCRAPER_DATA_DIR || 'data',
  };
}
