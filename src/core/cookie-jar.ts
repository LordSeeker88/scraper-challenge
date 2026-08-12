import type { AxiosRequestConfig, AxiosResponse } from 'axios';

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

/**
 * Minimal manual cookie jar (no external dependency).
 * JSF apps rely on JSESSIONID; the OEFA site also rewrites the session id
 * into URLs (`;jsessionid=...`), so we expose both mechanisms.
 */
export class CookieJar {
  private cookies: Cookie[] = [];

  /** Capture `Set-Cookie` headers from a response. */
  capture(res: AxiosResponse): void {
    const raw = res.headers['set-cookie'];
    if (!raw) return;
    const list = Array.isArray(raw) ? (raw as string[]) : [raw as string];
    for (const line of list) {
      if (!line) continue;
      const parts = line.split(';');
      const eq = parts[0].indexOf('=');
      if (eq <= 0) continue;
      const name = parts[0].slice(0, eq).trim();
      const value = parts[0].slice(eq + 1).trim();
      let domain = '';
      let path = '/';
      for (const attr of parts.slice(1)) {
        const kv = attr.trim().split('=');
        const k = kv[0].toLowerCase();
        if (k === 'domain') domain = (kv[1] ?? '').trim();
        if (k === 'path') path = (kv[1] ?? '/').trim() || '/';
      }
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.path === path));
      this.cookies.push({ name, value, domain, path });
    }
  }

  /** Inject the `Cookie` header into an axios request config for `url`. */
  apply(config: AxiosRequestConfig): AxiosRequestConfig {
    const header = this.headerFor(config.url ?? '');
    if (header) {
      config.headers = { ...(config.headers ?? {}), Cookie: header };
    }
    return config;
  }

  headerFor(url: string): string {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // URL may be relative; match domain-less cookies only.
    }
    return this.cookies
      .filter((c) => {
        const domain = c.domain.replace(/^\./, '');
        return !host || !domain || host === domain || host.endsWith('.' + domain);
      })
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  /** Manually set a cookie (used to persist a jsessionid seen in a URL). */
  set(name: string, value: string): void {
    this.cookies = this.cookies.filter((c) => c.name !== name);
    this.cookies.push({ name, value, domain: '', path: '/' });
  }

  get(name: string): string | undefined {
    return this.cookies.find((c) => c.name === name)?.value;
  }
}
