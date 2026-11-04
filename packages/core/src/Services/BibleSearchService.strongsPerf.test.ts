/**
 * B-164: a Strong's search for a very common number (G3588 "the") cost ~24 ms
 * per result because the number's gloss list holds thousands of distinct
 * renderings and every one was compiled into three regexes for every verse.
 * The service must bound that work and give the event loop back while it runs.
 */
import { describe, it, expect } from 'vitest';
import { BibleSearchService } from './BibleSearchService';
import { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { VerseIdHelper } from '../Data/Core/Types';
import type { IBibleRepository } from '../Data/Repositories/IBibleRepository';
import type { IBibleBookRepository } from '../Data/Repositories/IBibleBookRepository';

const VERSES = 600;
const ids = Array.from({ length: VERSES }, (_, i) => VerseIdHelper.calculate(43, 1 + Math.floor(i / 50), 1 + (i % 50)));
const glosses = ['God', 'Jesus', ...Array.from({ length: 5000 }, (_, i) => `rendering${i}`)];
const TEXT = 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish.';

const repo = {
  getSql: () => ({}),
  getModuleInfo: () => undefined,
  searchByStrongsNumber: () => ids,
  getGlossesForStrongs: () => glosses,
  getVerse: (verseId: number) => new BibleVerse({ verseId, text: TEXT, textPlain: TEXT }),
} as unknown as IBibleRepository;

const bookRepo = { getByBookNumber: (n: number) => ({ bookName: `Book${n}` }) } as unknown as IBibleBookRepository;

describe('Strong\'s search cost (B-164)', () => {
  it('does not scale with the number of distinct glosses', async () => {
    const service = new BibleSearchService(new Map([['KJV', repo]]), bookRepo);
    const started = Date.now();
    const results = await service.search('G3588', { modules: ['KJV'], maxResults: VERSES });
    const elapsed = Date.now() - started;
    expect(results).toHaveLength(VERSES);
    expect(elapsed).toBeLessThan(1000);
  });

  it('yields to the event loop while building a long result list', async () => {
    const service = new BibleSearchService(new Map([['KJV', repo]]), bookRepo);
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    await service.search('G3588', { modules: ['KJV'], maxResults: VERSES });
    clearInterval(timer);
    // Pre-fix the whole loop ran without a single await that let timers fire.
    expect(ticks).toBeGreaterThan(0);
  });
});
