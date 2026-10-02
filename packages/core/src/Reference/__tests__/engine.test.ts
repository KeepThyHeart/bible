import { describe, it, expect, beforeAll } from 'vitest';
import { ReferenceEngine, referenceEngineFor } from '../engine';
import { loadReferenceLocales } from '../registry';
import { encodeParse, encodeRange } from './helpers';

beforeAll(async () => {
  await loadReferenceLocales(['es', 'zh-Hans', 'ar', 'he', 'fa']);
});

const en = () => ReferenceEngine.create({ locales: ['en'] });
const esen = () => ReferenceEngine.create({ locales: ['es', 'en'] });

describe('locale priority', () => {
  it('es before en: "Job 3" is accepted (same book in both)', () => {
    const r = esen().parse('Job 3');
    expect(encodeParse(r)).toBe('18:3');
  });

  it('first locale wins on conflicting names ("Mar" is Mark in en, Marcos alias in es: same book here)', () => {
    const r = esen().parse('Mar 1:1');
    expect(encodeParse(r)).toBe('41:1:1');
  });

  it('en: "Jo 3:16" is John with the ambiguous alternatives', () => {
    const r = en().parse('Jo 3:16');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.book).toBe(43);
      expect(r.alternatives).toEqual([6, 18, 29, 32]);
      expect(r.via).toBe('exact');
      expect(r.locale).toBe('en');
    }
  });

  it('reports which locale matched', () => {
    const r = esen().parse('Juan 3:16');
    expect(r.ok && r.locale).toBe('es');
    const r2 = esen().parse('John 3:16');
    expect(r2.ok && r2.locale).toBe('en');
  });

  it('OSIS ids parse in every engine, reported as "osis"', () => {
    const r = ReferenceEngine.create({ locales: ['zh-Hans'] }).parse('1Cor 13:4');
    expect(encodeParse(r)).toBe('46:13:4');
    expect(r.ok && r.locale).toBe('osis');
  });

  it('exposes the tried locales without the osis pseudo-locale', () => {
    expect(esen().locales).toEqual(['es', 'en']);
    expect(referenceEngineFor('zh-CN').locales).toEqual(['zh-Hans', 'en']);
  });

  it('skips tags with no data', () => {
    expect(ReferenceEngine.create({ locales: ['xx', 'en'] }).locales).toEqual(['en']);
  });
});

describe('prefixes', () => {
  it('accepts a unique prefix', () => {
    const r = en().parse('Deuter 6:4');
    expect(encodeParse(r)).toBe('5:6:4');
    expect(r.ok && r.via).toBe('prefix');
  });

  it('rejects an ambiguous prefix', () => {
    expect(en().parse('Ph 1:1').ok).toBe(false);
    // "Phi" starts both Philippians and Philemon.
    expect(en().parse('Phi 1:1').ok).toBe(false);
  });

  it('prefix:false turns prefixes off', () => {
    expect(en().parse('Deuter 6:4', { prefix: false }).ok).toBe(false);
  });

  it('a prefix needs at least 3 letters', () => {
    expect(en().parse('De 6:4').ok).toBe(true); // "De" is an exact short name
    expect(en().parse('Dx 6:4').ok).toBe(false);
  });
});

describe('fuzzy matching', () => {
  it('is off by default', () => {
    expect(en().parse('Jhon 3:16').ok).toBe(false);
    expect(en().parse('Genisis 1:1').ok).toBe(false);
  });

  it('corrects typos when asked', () => {
    const r = en().parse('Genisis 1:1', { fuzzy: true });
    expect(encodeParse(r)).toBe('1:1:1');
    expect(r.ok && r.via).toBe('fuzzy');
    expect(encodeParse(en().parse('Romens 8:28', { fuzzy: true }))).toBe('45:8:28');
  });

  it('does not invent books from garbage', () => {
    expect(en().parse('Qzxqzx 1:1', { fuzzy: true }).ok).toBe(false);
  });
});

describe('whole books', () => {
  it('a bare book name needs allowWholeBook', () => {
    const r = en().parse('John');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('bad-numbers');
      expect(r.book).toBe(43);
    }
  });

  it('allowWholeBook returns a whole-book range', () => {
    const r = en().parse('John', { allowWholeBook: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ranges).toEqual([{ book: 43, chapter: 1, wholeBook: true }]);
  });

  it('only exact names count as a whole book', () => {
    expect(en().parse('Deuter', { allowWholeBook: true }).ok).toBe(false);
  });

  it('a whole book formats as the bare name', () => {
    expect(en().format({ book: 43, chapter: 1, wholeBook: true })).toBe('John');
  });
});

describe('context', () => {
  it('bookless "3:16" uses the context book', () => {
    const r = en().parse('3:16', { context: { book: 43 } });
    expect(encodeParse(r)).toBe('43:3:16');
    expect(r.ok && r.via).toBe('context');
    expect(r.ok && r.locale).toBe('context');
  });

  it('bookless "16-18" uses the context book and chapter', () => {
    expect(encodeParse(en().parse('16-18', { context: { book: 43, chapter: 3 } }))).toBe('43:3:16-18');
  });

  it('a bare "16" is a verse of the context chapter', () => {
    expect(encodeParse(en().parse('16', { context: { book: 43, chapter: 3 } }))).toBe('43:3:16');
  });

  it('a bare number without a context chapter is a chapter', () => {
    expect(encodeParse(en().parse('3', { context: { book: 43 } }))).toBe('43:3');
  });

  it('without context bookless input fails with no-book', () => {
    const r = en().parse('3:16');
    expect(r).toEqual({ ok: false, reason: 'no-book' });
  });

  it('a named book beats the context', () => {
    expect(encodeParse(en().parse('Romans 8:1', { context: { book: 43 } }))).toBe('45:8:1');
  });
});

describe('lists and ranges', () => {
  it('"John 3:16, 18; 4:1" is three ranges', () => {
    const r = en().parse('John 3:16, 18; 4:1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ranges.map(encodeRange)).toEqual(['43:3:16', '43:3:18', '43:4:1']);
    }
  });

  it('lists:false rejects a list', () => {
    expect(en().parse('John 3:16, 18', { lists: false }).ok).toBe(false);
  });

  it('ranges inside lists', () => {
    const r = en().parse('John 3:16-18, 20-22');
    expect(r.ok && r.ranges.map(encodeRange)).toEqual(['43:3:16-18', '43:3:20-22']);
  });

  it('cross-chapter and chapter ranges', () => {
    const a = en().parse('Genesis 1:31-2:3');
    expect(a.ok && a.ranges[0]).toEqual({ book: 1, chapter: 1, verse: 31, endChapter: 2, endVerse: 3 });
    const b = en().parse('Genesis 1-3');
    expect(b.ok && b.ranges[0]).toEqual({ book: 1, chapter: 1, endChapter: 3 });
  });

  it('a descending range is bad numbers', () => {
    const r = en().parse('John 3:18-16');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('bad-numbers');
  });

  it('trailing junk is not accepted', () => {
    expect(en().parse('John 3:16 is great').ok).toBe(false);
  });

  it('empty input', () => {
    expect(en().parse('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('single-chapter books take a bare number as the verse, "1:5" as chapter 1', () => {
    expect(encodeParse(en().parse('Obadiah 7'))).toBe('31:1:7');
    expect(encodeParse(en().parse('Obadiah 1:7'))).toBe('31:1:7');
    expect(encodeParse(en().parse('3 John 4'))).toBe('64:1:4');
  });
});

describe('checkChapters', () => {
  it('is off by default', () => {
    expect(en().parse('John 22:1').ok).toBe(true);
  });

  it('rejects chapters beyond the book', () => {
    const r = en().parse('John 22:1', { checkChapters: true });
    expect(r).toEqual({ ok: false, reason: 'out-of-range', book: 43 });
  });

  it('accepts the last chapter', () => {
    expect(en().parse('John 21:25', { checkChapters: true }).ok).toBe(true);
    expect(en().parse('Psalm 150', { checkChapters: true }).ok).toBe(true);
    expect(en().parse('Psalm 151', { checkChapters: true }).ok).toBe(false);
  });

  it('checks the end chapter of a range too', () => {
    expect(en().parse('John 20:1-22:3', { checkChapters: true }).ok).toBe(false);
  });
});

describe('scan offsets', () => {
  it('indexes the original text', () => {
    const text = 'Read John 3:16 now';
    const [m] = en().scan(text);
    expect(m.start).toBe(5);
    expect(m.end).toBe(14);
    expect(text.slice(m.start, m.end)).toBe('John 3:16');
    expect(m).toMatchObject({ book: 43, chapter: 3, verse: 16, locale: 'en', text: 'John 3:16' });
  });

  it('survives characters that normalise to a different length (ligature, ellipsis)', () => {
    const text = 'ﬁnd it… John 3:16 ok';
    const [m] = en().scan(text);
    expect(m.text).toBe('John 3:16');
    expect(text.slice(m.start, m.end)).toBe('John 3:16');
  });

  it('survives bidi marks before the reference', () => {
    const text = '‏‏‏See John 3:16';
    const [m] = en().scan(text);
    expect(text.slice(m.start, m.end)).toBe('John 3:16');
  });

  it('survives bidi marks inside the reference', () => {
    const text = 'See John‏ 3:16 now';
    const [m] = en().scan(text);
    expect(m.book).toBe(43);
    expect(text.slice(m.start, m.end)).toBe('John‏ 3:16');
  });

  it('survives full-width characters before and inside the reference', () => {
    const text = 'ＡＢＣ １２ John ３：１６ ok';
    const ms = en().scan(text);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ book: 43, chapter: 3, verse: 16 });
    expect(text.slice(ms[0].start, ms[0].end)).toBe('John ３：１６');
  });

  it('works in CJK text with full-width digits', async () => {
    const e = ReferenceEngine.create({ locales: ['zh-Hans', 'en'] });
    const text = '请看约翰福音３章１６节，然后罗马书8:28。';
    const ms = e.scan(text);
    expect(ms.map((m) => text.slice(m.start, m.end))).toEqual(['约翰福音３章１６节', '罗马书8:28']);
    expect(ms.map((m) => m.text)).toEqual(['约翰福音３章１６节', '罗马书8:28']);
  });

  it('works in Arabic text with bidi marks and native digits', () => {
    const e = ReferenceEngine.create({ locales: ['ar'] });
    const text = '‏اقرأ‏ يوحنا ٣:١٦ اليوم';
    const [m] = e.scan(text);
    expect(m.text).toBe('يوحنا ٣:١٦');
    expect(m.start).toBe(text.indexOf('يوحنا'));
  });

  it('list continuations start at the separator and are flagged', () => {
    const text = 'John 3:16, 18';
    const ms = en().scan(text);
    expect(ms.map((m) => [m.text, m.continuation ?? false])).toEqual([
      ['John 3:16', false],
      [', 18', true],
    ]);
    expect(ms[1]).toMatchObject({ book: 43, chapter: 3, verse: 18 });
  });

  it('finds several references in order', () => {
    const ms = en().scan('Gen 1:1, then Psalm 23 and Rom 8:28-30.');
    expect(ms.map((m) => m.text)).toEqual(['Gen 1:1', 'Psalm 23', 'Rom 8:28-30']);
    expect(ms.map((m) => m.start)).toEqual([...ms.map((m) => m.start)].sort((a, b) => a - b));
  });
});

describe('scan strictness', () => {
  it('requires capitals in cased scripts', () => {
    expect(en().scan('see job 3:1 and john 3:16')).toEqual([]);
    expect(en().scan('see Job 3:1').map((m) => m.text)).toEqual(['Job 3:1']);
  });

  it('requireCapital:false relaxes it', () => {
    expect(en().scan('see john 3:16', { requireCapital: false }).map((m) => m.text)).toEqual(['john 3:16']);
  });

  it('capital rule does not apply to caseless scripts', () => {
    expect(ReferenceEngine.create({ locales: ['ar'] }).scan('اقرأ يوحنا ٣:١٦')).toHaveLength(1);
  });

  it('short names need chapter and verse', () => {
    expect(en().scan('Is 5 apples')).toEqual([]);
    expect(en().scan('Is 5:1').map((m) => m.text)).toEqual(['Is 5:1']);
    expect(en().scan('Ge 1').map((m) => m.text)).toEqual([]);
    expect(en().scan('Ge 1:1').map((m) => m.text)).toEqual(['Ge 1:1']);
  });

  it('does not match inside a longer word', () => {
    expect(en().scan('Johnson 3:16')).toEqual([]);
    expect(en().scan('XJohn 3:16')).toEqual([]);
  });

  it('allows at most one space between name and number', () => {
    expect(en().scan('John  3:16')).toHaveLength(1); // whitespace is collapsed first
    expect(en().scan('John - 3:16')).toEqual([]);
  });

  it('does not use prefixes, typos or whole books', () => {
    expect(en().scan('Deuter 6:4')).toEqual([]);
    expect(en().scan('Genisis 1:1')).toEqual([]);
    expect(en().scan('We read John today')).toEqual([]);
  });

  it('numbered books, no-space lists and cross-chapter ranges in prose', () => {
    expect(en().scan('Try 1 John 4:8 and 2 Kings 2:11.').map((m) => m.text)).toEqual(['1 John 4:8', '2 Kings 2:11']);
    // Word ordinals are typed-input only: in prose "First" is an ordinary word.
    expect(en().scan('First John 4:8').map((m) => m.text)).toEqual(['John 4:8']);
    expect(en().parse('First John 4:8').ok && en().parse('First John 4:8')).toMatchObject({ book: 62 });
    expect(en().scan('John 3:16,18').map((m) => m.text)).toEqual(['John 3:16', ',18']);
    expect(en().scan('Gen 1:31-2:3').map((m) => m.text)).toEqual(['Gen 1:31-2:3']);
    expect(esen().scan('Lea 1 Corintios 13:4 hoy').map((m) => m.text)).toEqual(['1 Corintios 13:4']);
    expect(esen().scan('Lea Primera de Corintios 13:4 hoy').map((m) => m.book)).not.toContain(46);
  });

  it('negative prose', () => {
    expect(en().scan('I am 5')).toEqual([]);
    expect(en().scan('Mark my words 3 times')).toEqual([]);
    expect(ReferenceEngine.create({ locales: ['zh-Hans'] }).scan('约3个人')).toEqual([]);
  });

  it('skips out-of-order numbers (bad ranges)', () => {
    expect(en().scan('John 3:18-16')).toEqual([]);
  });
});

describe('format', () => {
  const john316 = { book: 43, chapter: 3, verse: 16 };

  it('en: long, medium and short', () => {
    const e = en();
    expect(e.format({ book: 46, chapter: 13, verse: 4 })).toBe('1 Corinthians 13:4');
    expect(e.format({ book: 46, chapter: 13, verse: 4 }, { style: 'medium' })).toBe('1 Cor 13:4');
    expect(e.format({ book: 46, chapter: 13, verse: 4 }, { style: 'short' })).toBe('1Co 13:4');
  });

  it('ranges, chapters and cross-chapter ranges', () => {
    const e = en();
    expect(e.format({ ...john316, endVerse: 18 })).toBe('John 3:16-18');
    expect(e.format({ book: 43, chapter: 3 })).toBe('John 3');
    expect(e.format({ book: 1, chapter: 1, endChapter: 3 })).toBe('Genesis 1-3');
    expect(e.format({ book: 1, chapter: 1, verse: 31, endChapter: 2, endVerse: 3 })).toBe('Genesis 1:31-2:3');
  });

  it('list format groups by chapter and book', () => {
    const e = en();
    const list = [
      { book: 43, chapter: 3, verse: 16 },
      { book: 43, chapter: 3, verse: 18 },
      { book: 43, chapter: 4, verse: 1 },
      { book: 45, chapter: 8, verse: 28 },
    ];
    expect(e.format(list)).toBe('John 3:16, 18; 4:1; Romans 8:28');
  });

  it('ar: native digits by default, latin on request', () => {
    const e = ReferenceEngine.create({ locales: ['ar'] });
    expect(e.format(john316)).toBe('يوحنا ٣:١٦');
    expect(e.format(john316, { digits: 'latin' })).toBe('يوحنا 3:16');
    expect(e.format({ ...john316, endVerse: 18 })).toBe('يوحنا ٣:١٦-١٨');
  });

  it('fa: Persian digits by default', () => {
    expect(ReferenceEngine.create({ locales: ['fa'] }).format(john316)).toBe('یوحنا ۳:۱۶');
  });

  it('he: latin digits by default, native override is a no-op without a numbering system', () => {
    const e = ReferenceEngine.create({ locales: ['he'] });
    expect(e.format(john316)).toBe('יוחנן 3:16');
    expect(e.format(john316, { digits: 'native' })).toBe('יוחנן 3:16');
  });

  it('zh: no gap, full-width list separators', () => {
    const e = ReferenceEngine.create({ locales: ['zh-Hans'] });
    expect(e.format(john316)).toBe('约翰福音3:16');
    expect(e.format(john316, { style: 'short' })).toBe('约3:16');
    const list = [
      { book: 43, chapter: 3, verse: 16 },
      { book: 43, chapter: 3, verse: 18 },
      { book: 43, chapter: 4, verse: 1 },
      { book: 45, chapter: 8, verse: 28 },
    ];
    expect(e.format(list)).toBe('约翰福音3:16，18；4:1；罗马书8:28');
  });

  it('format locale option picks another loaded locale', () => {
    const e = esen();
    expect(e.format(john316)).toBe('Juan 3:16');
    expect(e.format(john316, { locale: 'en' })).toBe('John 3:16');
    expect(e.format(john316, { locale: 'ar' })).toBe('يوحنا ٣:١٦');
  });

  it('output parses back to the same range', () => {
    for (const tag of ['en', 'es', 'zh-Hans', 'ar', 'he', 'fa']) {
      const e = ReferenceEngine.create({ locales: [tag] });
      const range = { book: 46, chapter: 13, verse: 4, endVerse: 7 };
      const r = e.parse(e.format(range));
      expect(r.ok && r.ranges[0], tag).toEqual(range);
    }
  });
});

describe('formatParts', () => {
  it('types each piece', () => {
    expect(en().formatParts({ book: 43, chapter: 3, verse: 16, endVerse: 18 })).toEqual([
      { type: 'book', value: 'John' },
      { type: 'separator', value: ' ' },
      { type: 'chapter', value: '3' },
      { type: 'separator', value: ':' },
      { type: 'verse', value: '16' },
      { type: 'separator', value: '-' },
      { type: 'verse', value: '18' },
    ]);
  });

  it('chapter-only and list separators', () => {
    const parts = en().formatParts([
      { book: 43, chapter: 3 },
      { book: 45, chapter: 8, verse: 28 },
    ]);
    expect(parts.map((p) => p.type)).toEqual(['book', 'separator', 'chapter', 'separator', 'book', 'separator', 'chapter', 'separator', 'verse']);
    expect(parts.map((p) => p.value).join('')).toBe('John 3; Romans 8:28');
  });

  it('zh has no book gap part', () => {
    const parts = ReferenceEngine.create({ locales: ['zh-Hans'] }).formatParts({ book: 43, chapter: 3, verse: 16 });
    expect(parts.map((p) => p.type)).toEqual(['book', 'chapter', 'separator', 'verse']);
  });

  it('a single range is accepted without an array, and parts join to format()', () => {
    const e = ReferenceEngine.create({ locales: ['ar'] });
    const r = { book: 43, chapter: 3, verse: 16 };
    expect(e.formatParts(r).map((p) => p.value).join('')).toBe(e.format(r));
  });
});

describe('bookName', () => {
  it('uses the first locale that has the book', () => {
    expect(esen().bookName(43)).toBe('Juan');
    expect(esen().bookName(46, 'short')).toBe('1 Co');
  });

  it('style fallbacks: short -> medium -> long', () => {
    expect(en().bookName(8, 'medium')).toBe('Ruth'); // no medium: falls back to long
    expect(en().bookName(18, 'short')).toBe('Job'); // no short or medium
    expect(en().bookName(19, 'short')).toBe('Ps'); // no short: medium
  });

  it('an unknown locale falls back to the engine locales (English)', () => {
    expect(en().bookName(43, 'long', 'xx')).toBe('John');
    expect(esen().bookName(43, 'long', 'xx')).toBe('Juan');
  });

  it('a named locale is preferred', () => {
    expect(esen().bookName(43, 'long', 'en')).toBe('John');
    expect(en().bookName(43, 'long', 'ar')).toBe('يوحنا');
  });

  it('with no locales the OSIS id is the name', () => {
    const e = ReferenceEngine.create({ locales: [] });
    expect(e.bookName(43)).toBe('John');
    expect(e.bookName(46)).toBe('1Cor');
    expect(e.bookName(1, 'short')).toBe('Gen');
  });

  it('out-of-canon book numbers get a generic label', () => {
    expect(ReferenceEngine.create({ locales: [] }).bookName(99)).toBe('Book 99');
  });
});

describe('lookupBook', () => {
  it('exact names, in priority order', () => {
    expect(esen().lookupBook('Juan')).toMatchObject({ book: 43, locale: 'es', via: 'exact' });
    expect(esen().lookupBook('Revelation')).toMatchObject({ book: 66, locale: 'en', via: 'exact' });
  });

  it('prefix and fuzzy only when asked', () => {
    expect(en().lookupBook('Deuter')).toBeUndefined();
    expect(en().lookupBook('Deuter', { prefix: true })).toMatchObject({ book: 5, via: 'prefix' });
    expect(en().lookupBook('Genisis')).toBeUndefined();
    expect(en().lookupBook('Genisis', { fuzzy: true })).toMatchObject({ book: 1, via: 'fuzzy' });
  });

  it('returns ambiguity alternatives', () => {
    expect(en().lookupBook('Jo')).toMatchObject({ book: 43, alternatives: [6, 18, 29, 32] });
  });

  it('does not match unknown names', () => {
    expect(en().lookupBook('Nonsense', { prefix: true })).toBeUndefined();
  });
});

describe('suggest', () => {
  it('suggests by prefix, labelled in the first locale', () => {
    const s = en().suggest('Gen');
    expect(s[0]).toMatchObject({ book: 1, label: 'Genesis', locale: 'en' });
  });

  it('puts prefix matches of the long name first and respects the limit', () => {
    const s = en().suggest('J', 3);
    expect(s).toHaveLength(3);
    expect(en().suggest('J', 0)).toEqual([]);
  });

  it('matches later words ("Solomon")', () => {
    expect(en().suggest('Solo').map((x) => x.book)).toContain(22);
  });

  it('numbered books', () => {
    const books = en().suggest('1 Cor').map((x) => x.book);
    expect(books).toContain(46);
    expect(books).not.toContain(47);
  });

  it('ignores accents (es) and works in other scripts', () => {
    expect(esen().suggest('Gene')[0].book).toBe(1);
    expect(esen().suggest('Isai')[0].book).toBe(23);
    expect(ReferenceEngine.create({ locales: ['ar'] }).suggest('يو').map((x) => x.book)).toContain(43);
    expect(ReferenceEngine.create({ locales: ['zh-Hans'] }).suggest('约翰').map((x) => x.book)).toContain(43);
  });

  it('nothing for empty input or input with digits after the book', () => {
    expect(en().suggest('')).toEqual([]);
    expect(en().suggest('John 3')).toEqual([]);
  });
});

describe('fallback and extraAliases', () => {
  it('fallback:"all" tries every loaded locale when nothing matched', () => {
    const strict = ReferenceEngine.create({ locales: ['en'] });
    expect(strict.parse('Juan 3:16').ok).toBe(false);
    const wide = ReferenceEngine.create({ locales: ['en'], fallback: 'all' });
    const r = wide.parse('Juan 3:16');
    expect(encodeParse(r)).toBe('43:3:16');
    expect(r.ok && r.locale).toBe('es');
  });

  it('extraAliases are parse-only names at the lowest priority', () => {
    const e = ReferenceEngine.create({ locales: ['en'], extraAliases: [{ name: 'Gospel of John', book: 43 }] });
    expect(encodeParse(e.parse('Gospel of John 3:16'))).toBe('43:3:16');
    expect(e.bookName(43)).toBe('John');
    expect(en().parse('Gospel of John 3:16').ok).toBe(false);
  });

  it('inline locale data is tried first', () => {
    const e = ReferenceEngine.create({
      locales: ['en'],
      inline: [{ tag: 'x-inline', ordinals: {}, books: { '43': { long: 'Ioannes' } } }],
    });
    expect(encodeParse(e.parse('Ioannes 3:16'))).toBe('43:3:16');
    expect(e.bookName(43)).toBe('Ioannes');
  });
});

describe('engine cache', () => {
  it('returns the same engine for the same options', () => {
    expect(ReferenceEngine.create({ locales: ['en'] })).toBe(ReferenceEngine.create({ locales: ['en'] }));
  });
});

describe('Hebrew punctuation', () => {
  const he = () => ReferenceEngine.create({ locales: ['he'] });

  it('ASCII apostrophe and quote forms parse', () => {
    expect(encodeParse(he().parse("בר' 1:1"))).toBe('1:1:1');
    expect(encodeParse(he().parse('שמ"א 3:10'))).toBe('9:3:10');
  });

  // Hebrew text normally uses geresh U+05F3 and gershayim U+05F4; the data spells
  // abbreviations with ASCII ' and ", and normalizeText maps one to the other.
  it('geresh U+05F3 matches the data apostrophe ("בר׳ 1:1")', () => {
    expect(encodeParse(he().parse('בר׳ 1:1'))).toBe('1:1:1');
  });
  it('geresh U+05F3 in a numbered name ("שמואל א׳ 3:10")', () => {
    expect(encodeParse(he().parse('שמואל א׳ 3:10'))).toBe('9:3:10');
  });
  it('gershayim U+05F4 matches the data quote ("שמ״א 3:10")', () => {
    expect(encodeParse(he().parse('שמ״א 3:10'))).toBe('9:3:10');
  });
});
