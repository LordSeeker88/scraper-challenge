import { es } from './es.js';
import { pt } from './pt.js';
import { en } from './en.js';

export type Lang = 'es' | 'pt' | 'en';
export type MessageKey = keyof typeof en;

const dicts: Record<Lang, Record<MessageKey, string>> = { es, pt, en };

/** Translate a message key, interpolating {var} placeholders. */
export function t(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  let msg = dicts[lang]?.[key] ?? dicts.en[key] ?? String(key);
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.replaceAll(`{${k}}`, String(v));
  }
  return msg;
}

/** Normalize a language string; anything invalid falls back to Spanish. */
export function normalizeLang(v?: string): Lang {
  return v === 'pt' || v === 'en' ? v : 'es';
}

export const LANGS: Lang[] = ['es', 'pt', 'en'];
