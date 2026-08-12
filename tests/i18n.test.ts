import { describe, expect, it } from 'vitest';
import { t, normalizeLang, LANGS } from '../src/i18n/index.js';
import { es } from '../src/i18n/es.js';
import { pt } from '../src/i18n/pt.js';
import { en } from '../src/i18n/en.js';

describe('i18n', () => {
  it('translates the same key in es, pt and en', () => {
    expect(t('es', 'start')).toBe('Iniciando extracción...');
    expect(t('pt', 'start')).toBe('Iniciando extração...');
    expect(t('en', 'start')).toBe('Starting extraction...');
  });

  it('interpolates placeholders', () => {
    expect(t('pt', 'pageProgress', { page: 3, total: 10, records: 47 })).toBe(
      'Página 3 de 10 — 47 registros',
    );
    expect(t('en', 'retry429', { attempt: 2, max: 5, delay: 2000 })).toBe(
      '429 Too Many Requests. Retry 2/5 in 2000 ms...',
    );
  });

  it('all dictionaries have identical key sets', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(pt).sort());
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('normalizes language, falling back to es', () => {
    expect(normalizeLang('pt')).toBe('pt');
    expect(normalizeLang('en')).toBe('en');
    expect(normalizeLang('es')).toBe('es');
    expect(normalizeLang('fr')).toBe('es');
    expect(normalizeLang(undefined)).toBe('es');
    expect(LANGS).toEqual(['es', 'pt', 'en']);
  });
});
