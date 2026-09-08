import { describe, it, expect } from 'vitest';
import { NETWORK_MAX_REDIRECTS } from '../config/constants';
import { isRedirectStatus, parseHttpUrl, resolveRedirectTarget } from './networkPolicy';

describe('isRedirectStatus', () => {
  it('recognises every redirect status, not just 301/302', () => {
    for (const status of [301, 302, 303, 307, 308]) {
      expect(isRedirectStatus(status)).toBe(true);
    }
  });

  it('ignores non-redirect statuses and a missing status', () => {
    for (const status of [200, 204, 206, 304, 400, 404, 500]) {
      expect(isRedirectStatus(status)).toBe(false);
    }
    expect(isRedirectStatus(undefined)).toBe(false);
  });
});

describe('parseHttpUrl', () => {
  it('accepts http and https', () => {
    expect(parseHttpUrl('https://example.org/catalog.json').protocol).toBe('https:');
    expect(parseHttpUrl('http://example.org/catalog.json').protocol).toBe('http:');
  });

  it('rejects any other scheme', () => {
    expect(() => parseHttpUrl('file:///C:/modules/catalog.json')).toThrow(/unsupported scheme/);
    expect(() => parseHttpUrl('ftp://example.org/x')).toThrow(/unsupported scheme/);
  });

  it('rejects malformed URLs and names the context', () => {
    expect(() => parseHttpUrl('not a url', 'download')).toThrow(/Invalid download URL/);
  });
});

describe('resolveRedirectTarget', () => {
  it('follows an absolute redirect', () => {
    expect(
      resolveRedirectTarget('https://a.example/catalog.json', 'https://b.example/catalog.json', 3)
    ).toBe('https://b.example/catalog.json');
  });

  it('resolves a relative Location against the current URL', () => {
    expect(resolveRedirectTarget('https://a.example/v1/catalog.json', '/v2/catalog.json', 3)).toBe(
      'https://a.example/v2/catalog.json'
    );
  });

  it('aborts once the redirect budget is exhausted', () => {
    expect(() =>
      resolveRedirectTarget('https://a.example/', 'https://b.example/', 0)
    ).toThrow(new RegExp(`Too many redirects \\(limit ${NETWORK_MAX_REDIRECTS}\\)`));
  });

  it('refuses an https → http downgrade', () => {
    expect(() =>
      resolveRedirectTarget('https://a.example/mod.db', 'http://a.example/mod.db', 3)
    ).toThrow(/https → http downgrade/);
  });

  it('allows http → https upgrades', () => {
    expect(resolveRedirectTarget('http://a.example/x', 'https://a.example/x', 3)).toBe(
      'https://a.example/x'
    );
  });

  it('rejects a redirect into a non-HTTP scheme', () => {
    expect(() =>
      resolveRedirectTarget('https://a.example/', 'file:///C:/Windows/System32/calc.exe', 3)
    ).toThrow(/unsupported scheme/);
  });

  it('rejects a missing or empty Location header', () => {
    expect(() => resolveRedirectTarget('https://a.example/', undefined, 3)).toThrow(
      /missing a Location header/
    );
    expect(() => resolveRedirectTarget('https://a.example/', '   ', 3)).toThrow(
      /missing a Location header/
    );
  });
});
