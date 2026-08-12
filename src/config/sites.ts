import { OefaAdapter } from '../extractors/oefa.js';
import { PjAdapter } from '../extractors/pj.js';
import type { SiteAdapter } from '../extractors/types.js';

/** Registry of supported sites. */
export const sites: Record<string, SiteAdapter> = {
  oefa: new OefaAdapter(),
  pj: new PjAdapter(),
};

export function getSite(id: string): SiteAdapter | undefined {
  return sites[id];
}
