import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import {
  cacheNamesFor,
  cacheRuleFor,
  isApiPath,
  preservedOnReset,
  resolveCacheName,
  validateRules,
  type CacheRule,
} from './cacheRules';
import { CACHE_RULES } from './rules';

const u = (path: string) => new URL(path, 'https://bible.example.com');

const rule = (over: Partial<CacheRule>): CacheRule => ({
  id: 'demo',
  strategy: 'cache-first',
  pattern: /\/demo\/v1\/[^/?]+(\?|$)/,
  cacheName: 'demo',
  ...over,
});

describe('shipped cache rules', () => {
  it('are valid', () => {
    expect(validateRules(CACHE_RULES)).toEqual([]);
  });

  it('cache the chapter content that used to be hard-coded in sw.ts', () => {
    expect(cacheRuleFor(CACHE_RULES, u('/api/commentary/all/43/3?modules=Barnes'))?.id).toBe('commentary-text');
    expect(cacheRuleFor(CACHE_RULES, u('/api/interlinear/43/3?module=KJV'))?.id).toBe('chapter-metadata');
    expect(cacheRuleFor(CACHE_RULES, u('/api/study/overview/43/3'))?.id).toBe('study-overview');
    expect(cacheRuleFor(CACHE_RULES, u('/data/semantic_int8.bin'))?.id).toBe('semantic-index');
    expect(cacheRuleFor(CACHE_RULES, u('/data/models/foo/onnx/model.onnx'))?.id).toBe('embedding-model');
  });

  it('never cache an API route that has no rule (allow-list only)', () => {
    for (const path of [
      '/api/bible/KJV/43/3',
      '/api/commentary/Barnes/verse/43003016',
      '/api/health',
      '/api/config',
      '/api/user/anything',
      '/base/api/whatever?x=1',
    ]) {
      expect(cacheRuleFor(CACHE_RULES, u(path)), path).toBeUndefined();
    }
  });

  it('never cache /api/sync or auth routes', () => {
    for (const path of ['/api/sync', '/api/sync/push', '/api/sync?since=3', '/api/auth/login', '/api/logout']) {
      expect(cacheRuleFor(CACHE_RULES, u(path)), path).toBeUndefined();
    }
  });

  it('never cache sync even when a later rule is written far too broadly', () => {
    const broad = rule({ id: 'broad', pattern: /.*/, cacheName: 'broad', allowApi: true });
    // The registry test would reject it, but the run-time guard must hold regardless.
    expect(cacheRuleFor([broad], u('/api/sync/pull'))).toBeUndefined();
    expect(cacheRuleFor([broad], u('/api/other'))).toBeDefined();
  });

  it('keep the large caches on reset, including the external transformers cache', () => {
    expect(preservedOnReset(CACHE_RULES).sort()).toEqual(
      [
        'audio-chapters-v1', 'audio-manifests-v1', 'embedding-model-v1', 'semantic-index-v1',
        'transformers-cache', 'tts-models-v1',
      ].sort(),
    );
  });

  it('public/sw-kill.js keeps exactly the caches a reset keeps', () => {
    const source = readFileSync(resolve(__dirname, '../../public/sw-kill.js'), 'utf-8');
    const list = /KEEP_CACHES = \[([^\]]*)\]/.exec(source)![1]
      .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    expect(list.sort()).toEqual(preservedOnReset(CACHE_RULES).sort());
  });
});

describe('cache names', () => {
  it('carry the version, so a bump abandons the old cache', () => {
    expect(resolveCacheName(rule({}))).toBe('demo-v1');
    expect(resolveCacheName(rule({ version: 3 }))).toBe('demo-v3');
    expect(cacheNamesFor([rule({}), rule({ id: 'n', strategy: 'network-only', cacheName: undefined })])).toEqual(['demo-v1']);
  });
});

describe('validateRules', () => {
  it('accepts a well-formed media rule', () => {
    expect(validateRules([rule({ id: 'audio', strategy: 'cache-first-range', pattern: /^\/audio\/v1\//, cacheName: 'audio', keepOnReset: true })])).toEqual([]);
  });

  it('requires allowApi for a pattern that matches API routes', () => {
    const problems = validateRules([rule({ pattern: /\/api\/notes\/[^/?]+(\?|$)/ })]);
    expect(problems.join()).toMatch(/allowApi/);
    expect(validateRules([rule({ pattern: /\/api\/notes\/[^/?]+(\?|$)/, allowApi: true })])).toEqual([]);
  });

  it('rejects a pattern that can match /api/sync', () => {
    const problems = validateRules([rule({ pattern: /\/api\/.*/, allowApi: true })]);
    expect(problems.join()).toMatch(/must never be cached/);
  });

  it('rejects duplicate ids and cache names, and a missing cache name', () => {
    expect(validateRules([rule({}), rule({})]).join()).toMatch(/duplicate id/);
    expect(validateRules([rule({ id: 'a' }), rule({ id: 'b' })]).join()).toMatch(/already used/);
    expect(validateRules([rule({ cacheName: undefined })]).join()).toMatch(/cacheName is required/);
  });

  it('rejects storing 401/403, sticky regexes and a bare trailing $', () => {
    expect(validateRules([rule({ statuses: [200, 401] })]).join()).toMatch(/401/);
    expect(validateRules([rule({ pattern: /\/demo\/x/g })]).join()).toMatch(/g or y flag/);
    expect(validateRules([rule({ pattern: /\/demo\/x$/ })]).join()).toMatch(/query string/);
  });
});

describe('isApiPath', () => {
  it('matches an api segment anywhere in the path only', () => {
    expect(isApiPath('/api/x')).toBe(true);
    expect(isApiPath('/base/api/x')).toBe(true);
    expect(isApiPath('/rapid/x')).toBe(false);
    expect(isApiPath('/data/api-docs.json')).toBe(false);
  });
});

describe('audio rules', () => {
  it('resolve to the cache names the page writes to', async () => {
    const { AUDIO_CACHE_NAMES } = await import('../audio/cacheNames');
    const names = Object.values(AUDIO_CACHE_NAMES).sort();
    const fromRules = CACHE_RULES.filter(r => r.owner === 'audio').map(resolveCacheName).sort();
    expect(fromRules).toEqual(names);
  });

  it('cache recorded chapters with range support and never the mutable index', () => {
    const file = cacheRuleFor(CACHE_RULES, new URL('https://x.test/audio/v1/KJV/narr/r1/43/003.ogg'));
    expect(file?.strategy).toBe('cache-first-range');
    expect(cacheRuleFor(CACHE_RULES, new URL('https://x.test/audio/v1/KJV/index.json'))).toBeUndefined();
  });
});
