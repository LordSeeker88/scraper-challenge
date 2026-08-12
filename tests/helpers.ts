import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

// Lê fixtures reais (HTML/XML capturados do site) pra testar sem depender de rede.
export async function fixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), 'utf8');
}
