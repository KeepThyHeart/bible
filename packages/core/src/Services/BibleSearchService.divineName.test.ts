/** B-167: keyword results keep the divine-name span so "LORD" and "Lord" can differ. */
import { describe, it, expect } from 'vitest';
import { BibleSearchService } from './BibleSearchService';
import { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { VerseIdHelper } from '../Data/Core/Types';
import type { IBibleRepository } from '../Data/Repositories/IBibleRepository';
import type { IBibleBookRepository } from '../Data/Repositories/IBibleBookRepository';
import { TestSqliteProvider } from '../__tests__/helpers/TestSqliteProvider';

const GEN_22_14 = VerseIdHelper.calculate(1, 22, 14);
const HTML = 'And Abraham called the name of that place Jehovahjireh: as it is said to this day, In the mount of the <span class="divine-name">Lord</span> it shall be seen.';
const PLAIN = HTML.replace(/<[^>]*>/g, '');
const sql = new TestSqliteProvider(':memory:');

const repo = {
  getSql: () => sql,
  getModuleInfo: () => undefined,
  getVerse: () => new BibleVerse({ verseId: GEN_22_14, text: HTML, textPlain: PLAIN }),
  searchVersesWithHighlighting: () => [{
    verse: new BibleVerse({ verseId: GEN_22_14, text: HTML, textPlain: PLAIN }),
    highlightedText: PLAIN,
    highlightedPlainText: PLAIN,
  }],
} as unknown as IBibleRepository;
const bookRepo = { getByBookNumber: () => ({ bookName: 'Genesis' }) } as unknown as IBibleBookRepository;

describe('divine name in search results (B-167)', () => {
  it('keeps the span in text and in the snippet', async () => {
    const service = new BibleSearchService(new Map([['kjv', repo]]), bookRepo);
    const [hit] = await service.search('mount shall seen', { modules: ['kjv'], maxResults: 5 });
    expect(hit.text).toContain('<span class="divine-name">Lord</span>');
    expect(hit.snippet ?? '').toContain('<span class="divine-name">Lord</span>');
  });
});
