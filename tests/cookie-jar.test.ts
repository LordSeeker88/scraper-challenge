import { describe, expect, it } from 'vitest';
import { CookieJar } from '../src/core/cookie-jar.js';

function fakeResponse(setCookie: string | string[]) {
  return { headers: { 'set-cookie': setCookie } } as any;
}

describe('CookieJar', () => {
  it('captures JSESSIONID and sends it for the matching host', () => {
    const jar = new CookieJar();
    jar.capture(fakeResponse(['JSESSIONID=ABC123; Path=/; HttpOnly']));
    expect(jar.get('JSESSIONID')).toBe('ABC123');
    expect(jar.headerFor('https://publico.oefa.gob.pe/repdig/')).toContain('JSESSIONID=ABC123');
  });

  it('filters cookies by domain', () => {
    const jar = new CookieJar();
    jar.capture(fakeResponse(['a=1; Domain=.oefa.gob.pe; Path=/']));
    jar.capture(fakeResponse(['b=2; Domain=.example.com; Path=/']));
    const header = jar.headerFor('https://publico.oefa.gob.pe/x');
    expect(header).toContain('a=1');
    expect(header).not.toContain('b=2');
  });

  it('replaces a cookie with the same name and path', () => {
    const jar = new CookieJar();
    jar.capture(fakeResponse(['JSESSIONID=OLD; Path=/']));
    jar.capture(fakeResponse(['JSESSIONID=NEW; Path=/']));
    expect(jar.get('JSESSIONID')).toBe('NEW');
    expect(jar.headerFor('https://x.example/')).toContain('JSESSIONID=NEW');
  });

  it('supports manual set/get (for jsessionid found in a URL)', () => {
    const jar = new CookieJar();
    jar.set('JSESSIONID', 'URLSESSION');
    expect(jar.headerFor('https://x.example/')).toContain('JSESSIONID=URLSESSION');
  });

  it('apply() injects the Cookie header into an axios config', () => {
    const jar = new CookieJar();
    jar.set('JSESSIONID', 'S');
    const config = jar.apply({ url: 'https://x.example/', headers: { Accept: 'text/html' } });
    expect((config.headers as any).Cookie).toContain('JSESSIONID=S');
    expect((config.headers as any).Accept).toBe('text/html');
  });
});
