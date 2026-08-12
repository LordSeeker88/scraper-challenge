import { describe, expect, it } from 'vitest';
import { sanitizeFilename, buildPdfName } from '../src/pdf/naming.js';

describe('sanitizeFilename', () => {
  it('replaces invalid Windows characters', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('collapses whitespace and trims trailing dots/spaces', () => {
    expect(sanitizeFilename('  resolución   nº 1  ')).toBe('resolución nº 1');
    expect(sanitizeFilename('doc...')).toBe('doc');
  });

  it('keeps accents (valid on Windows) but caps length', () => {
    const long = 'x'.repeat(300);
    expect(sanitizeFilename(long)).toHaveLength(120);
    expect(sanitizeFilename('CAFÉ Ñandú')).toBe('CAFÉ Ñandú');
  });

  it('handles reserved Windows device names', () => {
    expect(sanitizeFilename('CON')).toBe('doc_CON');
    expect(sanitizeFilename('COM1')).toBe('doc_COM1');
  });

  it('falls back to a default for empty input', () => {
    expect(sanitizeFilename('   ')).toBe('documento');
  });
});

describe('buildPdfName', () => {
  it('combines expediente + title and adds an index suffix', () => {
    const doc = { id: 'x', expediente: '00123-2019-OEFA/DFSAI', title: 'MINERA SANTA ROSA' };
    expect(buildPdfName(doc, 0)).toBe('00123-2019-OEFA_DFSAI_MINERA SANTA ROSA.pdf');
    expect(buildPdfName(doc, 1)).toBe('00123-2019-OEFA_DFSAI_MINERA SANTA ROSA_2.pdf');
  });

  it('falls back to the document id when no title/expediente', () => {
    expect(buildPdfName({ id: 'oefa_row_3' }, 0)).toBe('oefa_row_3.pdf');
  });
});
