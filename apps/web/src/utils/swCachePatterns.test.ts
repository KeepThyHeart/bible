/**
 * Workbox matches a RegExp route against the **whole URL**, so a trailing `$`
 * silently excludes every request that carries a query string — and the route
 * then never fires, with no error anywhere. These patterns all describe URLs
 * that do carry one, so that failure mode is the one worth pinning.
 */
import { describe, it, expect } from 'vitest';
import {
  COMMENTARY_CACHE_PATTERN,
  INTERLINEAR_CACHE_PATTERN,
  STUDY_OVERVIEW_CACHE_PATTERN,
} from './swCachePatterns';

const ORIGIN = 'https://bible.example.com';

describe('service worker cache patterns', () => {
  describe('commentary', () => {
    it.each([
      // The request a chapter change makes for every background tab at once.
      `${ORIGIN}/api/commentary/all/43/3?modules=Barnes,Geneva,Clarke`,
      `${ORIGIN}/api/commentary/all/43/3`,
      // A single module, on demand.
      `${ORIGIN}/api/commentary/Barnes/43/3`,
      // Chapter metadata served under the same prefix.
      `${ORIGIN}/api/commentary/chapter-overview/43/3`,
      `${ORIGIN}/api/commentary/home/43/3?verse=16`,
      // Under a non-root deployment base path.
      `${ORIGIN}/bible/api/commentary/Barnes/43/3`,
    ])('caches %s', url => {
      expect(COMMENTARY_CACHE_PATTERN.test(url)).toBe(true);
    });

    it.each([
      // Per-verse entries: the segment after the module is not a number.
      `${ORIGIN}/api/commentary/Barnes/verse/43003016`,
      `${ORIGIN}/api/commentary/info/Barnes`,
      `${ORIGIN}/api/commentary/Geneva/chapter-verses/43/3`,
    ])('leaves %s to the network', url => {
      expect(COMMENTARY_CACHE_PATTERN.test(url)).toBe(false);
    });
  });

  describe('interlinear', () => {
    it('caches the request the pane actually makes, which names a module', () => {
      expect(INTERLINEAR_CACHE_PATTERN.test(`${ORIGIN}/api/interlinear/43/3?module=KJV`)).toBe(true);
    });

    it('caches the bare form too', () => {
      expect(INTERLINEAR_CACHE_PATTERN.test(`${ORIGIN}/api/interlinear/43/3`)).toBe(true);
    });

    it('does not match a different endpoint that starts the same way', () => {
      expect(INTERLINEAR_CACHE_PATTERN.test(`${ORIGIN}/api/interlinear/43`)).toBe(false);
    });
  });

  describe('study overview', () => {
    it('caches the chapter endpoint', () => {
      expect(STUDY_OVERVIEW_CACHE_PATTERN.test(`${ORIGIN}/api/study/overview/43/3`)).toBe(true);
    });
  });

  it('never matches an auth-gated or user-specific endpoint', () => {
    const offLimits = [
      `${ORIGIN}/api/health`,
      `${ORIGIN}/api/config`,
      `${ORIGIN}/api/version`,
      `${ORIGIN}/api/feedback`,
      `${ORIGIN}/api/search/keyword?q=grace`,
    ];
    for (const url of offLimits) {
      expect(COMMENTARY_CACHE_PATTERN.test(url)).toBe(false);
      expect(INTERLINEAR_CACHE_PATTERN.test(url)).toBe(false);
      expect(STUDY_OVERVIEW_CACHE_PATTERN.test(url)).toBe(false);
    }
  });
});
