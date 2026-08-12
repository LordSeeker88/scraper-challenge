import { t, type Lang, type MessageKey } from '../i18n/index.js';

/** Minimal structured logger with trilingual messages. */
export class Logger {
  constructor(public lang: Lang = 'es') {}

  private ts(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  private fmt(kind: string, key: MessageKey, vars?: Record<string, string | number>): string {
    return `[${this.ts()}] [${kind}] ${t(this.lang, key, vars)}`;
  }

  info(key: MessageKey, vars?: Record<string, string | number>): void {
    console.log(this.fmt('INFO', key, vars));
  }

  warn(key: MessageKey, vars?: Record<string, string | number>): void {
    console.warn(this.fmt('WARN', key, vars));
  }

  error(key: MessageKey, vars?: Record<string, string | number>): void {
    console.error(this.fmt('ERROR', key, vars));
  }

  /** Raw line (e.g. help text), passed through untouched. */
  raw(msg: string): void {
    console.log(msg);
  }
}
