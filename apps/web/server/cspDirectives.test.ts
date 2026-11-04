import { describe, it, expect } from 'vitest';
import { contentSecurityPolicyDirectives, speechModelOrigins, HUGGING_FACE_ORIGINS } from './cspDirectives';

const connect = (d: ReturnType<typeof contentSecurityPolicyDirectives>) => Array.from(d.connectSrc ?? []);

describe('speech CSP additions', () => {
  it('leaves the policy unchanged when speech is off, whatever origins are given', () => {
    const base = contentSecurityPolicyDirectives();
    expect(contentSecurityPolicyDirectives(undefined, { enabled: false, externalOrigins: ['https://x.example'] })).toEqual(base);
    expect(connect(base)).toEqual(["'self'"]);
  });

  it('adds only the model origins to connect-src when on', () => {
    const on = contentSecurityPolicyDirectives(undefined, { enabled: true, externalOrigins: speechModelOrigins('') });
    expect(connect(on)).toEqual(["'self'", ...HUGGING_FACE_ORIGINS]);
    expect(Array.from(on.scriptSrc ?? [])).toContain("'wasm-unsafe-eval'");
    expect(on.mediaSrc).toBeUndefined();
  });

  it('merges with audio origins without duplicates', () => {
    const d = contentSecurityPolicyDirectives(
      { enabled: true, externalOrigins: ['https://m.example'] },
      { enabled: true, externalOrigins: ['https://m.example'] },
    );
    expect(connect(d)).toEqual(["'self'", 'https://m.example']);
  });
});

describe('speechModelOrigins', () => {
  it('defaults to Hugging Face and its CDNs', () => {
    expect(speechModelOrigins(undefined)).toEqual(HUGGING_FACE_ORIGINS);
    expect(speechModelOrigins('  ')).toEqual(HUGGING_FACE_ORIGINS);
  });
  it('allows only a mirror\'s own origin', () => {
    expect(speechModelOrigins('https://models.example.com/speech/')).toEqual(['https://models.example.com']);
  });
  it('allows nothing for an unusable value', () => {
    expect(speechModelOrigins('not a url')).toEqual([]);
    expect(speechModelOrigins('javascript:alert(1)')).toEqual([]);
  });
});
