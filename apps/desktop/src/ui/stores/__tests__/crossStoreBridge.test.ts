/**
 * Unit tests for crossStoreBridge - the nullable-callback registry that
 * decouples stores from each other. Verifies that
 * setters install implementations, getters invoke them, and the safe no-op
 * behavior when a bridge has not been wired.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  navigateToVerseInPrimary,
  resolvePrimaryBibleVerseId,
  resolveOpenModuleAbbreviations,
  setNavigateToVerseInPrimary,
  setResolvePrimaryBibleVerseId,
  setResolveOpenModuleAbbreviations,
} from '../crossStoreBridge';

describe('crossStoreBridge', () => {
  beforeEach(() => {
    // Reset all bridges between tests (the contract allows tests to reset).
    setNavigateToVerseInPrimary(null);
    setResolvePrimaryBibleVerseId(null);
    setResolveOpenModuleAbbreviations(null);
  });

  describe('navigateToVerseInPrimary', () => {
    it('is a safe no-op when unwired', () => {
      expect(() => navigateToVerseInPrimary(43003016)).not.toThrow();
    });

    it('invokes the installed implementation with the verse id', () => {
      const calls: number[] = [];
      setNavigateToVerseInPrimary((id) => { calls.push(id); });
      navigateToVerseInPrimary(43003016);
      navigateToVerseInPrimary(1001001);
      expect(calls).toEqual([43003016, 1001001]);
    });

    it('unwires cleanly when set to null', () => {
      const calls: number[] = [];
      setNavigateToVerseInPrimary((id) => { calls.push(id); });
      setNavigateToVerseInPrimary(null);
      navigateToVerseInPrimary(99);
      expect(calls).toEqual([]);
    });
  });

  describe('resolvePrimaryBibleVerseId', () => {
    it('returns null when unwired', () => {
      expect(resolvePrimaryBibleVerseId()).toBeNull();
    });

    it('returns the value from the installed resolver', () => {
      setResolvePrimaryBibleVerseId(() => 43003016);
      expect(resolvePrimaryBibleVerseId()).toBe(43003016);
    });

    it('forwards null returned by the resolver', () => {
      setResolvePrimaryBibleVerseId(() => null);
      expect(resolvePrimaryBibleVerseId()).toBeNull();
    });

    it('calls the resolver each time (no caching)', () => {
      let count = 0;
      setResolvePrimaryBibleVerseId(() => ++count);
      expect(resolvePrimaryBibleVerseId()).toBe(1);
      expect(resolvePrimaryBibleVerseId()).toBe(2);
    });
  });

  describe('resolveOpenModuleAbbreviations', () => {
    it('returns empty array when unwired', () => {
      expect(resolveOpenModuleAbbreviations()).toEqual([]);
    });

    it('returns the list from the installed resolver', () => {
      setResolveOpenModuleAbbreviations(() => ['KJV', 'ESV']);
      expect(resolveOpenModuleAbbreviations()).toEqual(['KJV', 'ESV']);
    });

    it('forwards an empty array from the resolver', () => {
      setResolveOpenModuleAbbreviations(() => []);
      expect(resolveOpenModuleAbbreviations()).toEqual([]);
    });
  });
});
