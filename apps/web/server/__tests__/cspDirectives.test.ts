import { describe, it, expect } from 'vitest';
import { contentSecurityPolicyDirectives } from '../cspDirectives';

describe('contentSecurityPolicyDirectives', () => {
  it('allows only this origin for connect-src by default', () => {
    expect(contentSecurityPolicyDirectives().connectSrc).toEqual(["'self'"]);
  });

  it('adds exactly the bibsearch origin for remote search via the browser', () => {
    const d = contentSecurityPolicyDirectives(undefined, undefined, 'https://search.example.org');
    expect(d.connectSrc).toEqual(["'self'", 'https://search.example.org']);
    expect(d.mediaSrc).toBeUndefined();
  });

  it('keeps audio origins and the bibsearch origin together', () => {
    const d = contentSecurityPolicyDirectives({ enabled: true, externalOrigins: ['https://a.example'] }, undefined, 'https://s.example');
    expect(d.connectSrc).toEqual(["'self'", 'https://a.example', 'https://s.example']);
  });
});
