import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/main.js';

describe('parseArgs', () => {
  it('applies defaults', () => {
    const opts = parseArgs([]);
    expect(opts.site).toBe('oefa');
    expect(opts.pdfs).toBe(true);
    expect(opts.resume).toBe(false);
    expect(opts.help).toBe(false);
  });

  it('parses all flags', () => {
    const opts = parseArgs([
      '--site', 'pj', '--lang', 'pt', '--expediente', 'ABC-2018',
      '--administrado', 'MINERA', '--unidad-fiscalizable', 'LOTE X', '--materia', 'Civil',
      '--limit', '25', '--max-pages', '3', '--delay-ms', '2000',
      '--resume', '--no-pdfs', '--pdfs-dir', 'out/pdfs', '--sector', '1', '--resolucion', 'R1',
    ]);
    expect(opts.site).toBe('pj');
    expect(opts.lang).toBe('pt');
    expect(opts.query.expediente).toBe('ABC-2018');
    expect(opts.query.administrado).toBe('MINERA');
    expect(opts.query.unidadFiscalizable).toBe('LOTE X');
    expect(opts.query.materia).toBe('Civil');
    expect(opts.query.sector).toBe('1');
    expect(opts.query.resolucion).toBe('R1');
    expect(opts.limit).toBe(25);
    expect(opts.maxPages).toBe(3);
    expect(opts.delayMs).toBe(2000);
    expect(opts.resume).toBe(true);
    expect(opts.pdfs).toBe(false);
    expect(opts.pdfsDir).toBe('out/pdfs');
  });

  it('rejects unknown options', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown option/);
  });

  it('rejects missing values', () => {
    expect(() => parseArgs(['--limit'])).toThrow(/requires a value/);
  });

  it('rejects non-positive integers', () => {
    expect(() => parseArgs(['--limit', '0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--limit', 'abc'])).toThrow(/positive integer/);
  });

  it('supports --help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});
