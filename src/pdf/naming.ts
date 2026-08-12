/**
 * Descriptive, filesystem-safe PDF filenames.
 * Windows-reserved names (CON, PRN, NUL, COM1..) are prefixed defensively.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeFilename(s: string): string {
  let out = s
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  out = out.replace(/[. ]+$/g, '');
  if (RESERVED.test(out)) out = `doc_${out}`;
  if (!out) out = 'documento';
  return out.slice(0, 120);
}

/** Build a descriptive filename: <expediente>_<label>_<index>.pdf */
export function buildPdfName(
  doc: { id: string; expediente?: string; title?: string },
  index: number,
): string {
  const parts = [doc.expediente, doc.title ?? doc.id].filter(Boolean);
  const base = sanitizeFilename(parts.join('_'));
  const suffix = index > 0 ? `_${index + 1}` : '';
  return `${base}${suffix}.pdf`;
}
