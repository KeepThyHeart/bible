import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BibleSearchService } from './BibleSearchService';
import { SearchQueryRejectedError } from './SearchQueryParser';
import { KJVTestHelper } from '../__tests__/helpers/KJVTestHelper';
import { IBibleRepository } from '../Data/Repositories/IBibleRepository';

const KJV_AVAILABLE = KJVTestHelper.isAvailable();

describe.skipIf(!KJV_AVAILABLE)('BibleSearchService hardening', () => {
  let kjv: IBibleRepository;

  beforeAll(() => {
    KJVTestHelper.initialize();
    kjv = KJVTestHelper.getKJVRepository();
  });

  afterAll(() => {
    KJVTestHelper.cleanup();
  });

  const newService = () => new BibleSearchService(new Map(), KJVTestHelper.getBibleBookRepository());

  describe('W-001: allowRegex', () => {
    it('runs /pattern/ by default (desktop)', async () => {
      const service = newService();
      service.addBibleModule('KJV', kjv);
      const results = await service.search('/^Jesus wept\\.?$/', { modules: ['KJV'], maxResults: 10, range: { startBook: 43, endBook: 43 } });
      expect(results.length).toBe(1);
    });

    it('refuses /pattern/ without touching a verse when allowRegex is false', async () => {
      const service = newService();
      service.addBibleModule('KJV', kjv);
      const t = performance.now();
      // The W-001 pattern: catastrophic backtracking on any verse that does not match.
      await expect(
        service.search('/^(\\w+\\s?)*$/', { modules: ['KJV'], maxResults: 10, allowRegex: false })
      ).rejects.toBeInstanceOf(SearchQueryRejectedError);
      expect(performance.now() - t).toBeLessThan(1000);
    });

    it('refuses an invalid pattern the same way, not as a syntax error', async () => {
      const service = newService();
      service.addBibleModule('KJV', kjv);
      await expect(service.search('/[/', { modules: ['KJV'], allowRegex: false })).rejects.toBeInstanceOf(SearchQueryRejectedError);
    });
  });

  describe('W-002: one Bible under two names', () => {
    it('keeps the first name working after the same Bible is added as "kjv"', async () => {
      const service = newService();
      service.addBibleModule('KJV', kjv);
      const before = await service.search('charity', { modules: ['KJV'], maxResults: 500, autoFuzzy: false });
      expect(before.length).toBeGreaterThan(0);

      service.addBibleModule('kjv', kjv);
      const lower = await service.search('charity', { modules: ['kjv'], maxResults: 500, autoFuzzy: false });
      const after = await service.search('charity', { modules: ['KJV'], maxResults: 500, autoFuzzy: false });

      expect(lower.length).toBe(before.length);
      expect(after.length).toBe(before.length);
      expect(service.getRegisteredModules()).toEqual(['KJV']);
    });

    it('does not search the same Bible twice when no modules are named', async () => {
      const service = newService();
      service.addBibleModule('KJV', kjv);
      const once = await service.search('charity', { maxResults: 500, autoFuzzy: false });
      service.addBibleModule('kjv', kjv);
      service.addBibleModule('Kjv', kjv);
      const again = await service.search('charity', { maxResults: 500, autoFuzzy: false });
      // Results are de-duplicated by verse, so the scan count shows only here.
      expect(service.getRegisteredModules()).toEqual(['KJV']);
      expect(again.map(r => [r.verseId, r.module])).toEqual(once.map(r => [r.verseId, r.module]));
    });
  });
});
