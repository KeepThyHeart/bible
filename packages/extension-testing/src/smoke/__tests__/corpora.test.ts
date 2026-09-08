import { describe, it, expect } from 'vitest';

import { INPUT_SHAPE_BY_KIND } from '../enumerateHooks';
import type { HookKind } from '../types';
import {
  DEFAULT_CORPUS,
  DEFAULT_VERSE_ID_CORPUS,
  DEFAULT_VERSE_RANGE_CORPUS,
  DEFAULT_REFERENCE_STRING_CORPUS,
  DEFAULT_DICTIONARY_KEY_CORPUS,
  DEFAULT_SECTION_ID_CORPUS,
  DEFAULT_STORAGE_CORPUS,
  DEFAULT_NETWORK_CORPUS,
  getDefaultCorpus,
  getCorpusForShape,
  mergeCorpus,
  validateUserCorpus,
  CorpusValidationError,
} from '../corpora';

const ALL_KINDS: HookKind[] = [
  'command',
  'contextMenu',
  'panelType',
  'statusBar',
  'hover',
  'decorator',
  'displayMode',
  'bibleProvider',
  'commentaryProvider',
  'dictionaryProvider',
  'bookProvider',
  'highlightStyle',
  'event',
];

describe('default corpora', () => {
  it('every hook kind has a non-empty default corpus', () => {
    for (const kind of ALL_KINDS) {
      const corpus = getDefaultCorpus(kind);
      expect(corpus.length, `kind=${kind}`).toBeGreaterThan(0);
    }
  });

  it('INPUT_SHAPE_BY_KIND covers every HookKind', () => {
    for (const kind of ALL_KINDS) {
      expect(INPUT_SHAPE_BY_KIND[kind]).toBeDefined();
    }
  });

  it('verse corpus includes single-verse books and chapter/book boundaries', () => {
    // Obadiah 1:1, Philemon 1:25, 3 John 1:14, Jude 1:25, boundaries.
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(31001001); // Obadiah 1:1
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(57001025); // Philemon 1:25
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(64001014); // 3 John 1:14
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(65001025); // Jude 1:25
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(1001031);  // Gen 1:31
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(1002001);  // Gen 2:1
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(39004006); // Mal 4:6
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(40001001); // Matt 1:1
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(66022021); // Rev 22:21
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(19117001); // Ps 117:1
    expect(DEFAULT_VERSE_ID_CORPUS).toContain(19119176); // Ps 119:176
    expect(DEFAULT_VERSE_ID_CORPUS.length).toBeGreaterThanOrEqual(90);
  });

  it('verse range corpus covers full-book single-chapter ranges', () => {
    const has = (start: number, end: number): boolean =>
      DEFAULT_VERSE_RANGE_CORPUS.some(
        (r) => r.startVerseId === start && r.endVerseId === end,
      );
    expect(has(31001001, 31001021)).toBe(true); // Obadiah
    expect(has(57001001, 57001025)).toBe(true); // Philemon
    expect(has(65001001, 65001025)).toBe(true); // Jude
    expect(has(19119001, 19119176)).toBe(true); // Ps 119 full
  });

  it('reference-string corpus includes canonical, abbreviated, malformed, and Unicode forms', () => {
    expect(DEFAULT_REFERENCE_STRING_CORPUS).toContain('John 3:16');
    expect(DEFAULT_REFERENCE_STRING_CORPUS).toContain('Jn 3:16');
    expect(DEFAULT_REFERENCE_STRING_CORPUS).toContain('Jno. 3:16');
    expect(DEFAULT_REFERENCE_STRING_CORPUS).toContain('1 Cor 13:4-7');
    expect(DEFAULT_REFERENCE_STRING_CORPUS).toContain('');
    expect(DEFAULT_REFERENCE_STRING_CORPUS).toContain('John 3::16');
    expect(DEFAULT_REFERENCE_STRING_CORPUS).toContain('John :16');
    expect(DEFAULT_REFERENCE_STRING_CORPUS).toContain('Juan 3:16');
  });

  it('dictionary-key corpus includes Strong’s numbers and malformed keys', () => {
    expect(DEFAULT_DICTIONARY_KEY_CORPUS).toContain('G25');
    expect(DEFAULT_DICTIONARY_KEY_CORPUS).toContain('H430');
    expect(DEFAULT_DICTIONARY_KEY_CORPUS).toContain('');
  });

  it('section-id corpus exists for book providers', () => {
    expect(DEFAULT_SECTION_ID_CORPUS.length).toBeGreaterThan(0);
  });

  it('storage corpus has empty, near-quota, and oversized states', () => {
    const ids = DEFAULT_STORAGE_CORPUS.map((s) => s.id);
    expect(ids).toContain('empty');
    expect(ids).toContain('near-quota');
    expect(ids).toContain('oversized-write');
    const oversized = DEFAULT_STORAGE_CORPUS.find((s) => s.id === 'oversized-write');
    expect(oversized?.oversizedWrite?.value.length).toBeGreaterThan(64 * 1024);
  });

  it('network corpus covers success / 404 / 500 / timeout / offline', () => {
    const kinds = new Set(DEFAULT_NETWORK_CORPUS.map((n) => n.kind));
    expect(kinds.has('success')).toBe(true);
    expect(kinds.has('notFound')).toBe(true);
    expect(kinds.has('serverError')).toBe(true);
    expect(kinds.has('timeout')).toBe(true);
    expect(kinds.has('offline')).toBe(true);
  });

  it('getCorpusForShape routes every shape to the right field', () => {
    expect(getCorpusForShape('verseId')).toBe(DEFAULT_CORPUS.verseIds);
    expect(getCorpusForShape('verseRange')).toBe(DEFAULT_CORPUS.verseRanges);
    expect(getCorpusForShape('referenceString')).toBe(DEFAULT_CORPUS.referenceStrings);
    expect(getCorpusForShape('dictionaryKey')).toBe(DEFAULT_CORPUS.dictionaryKeys);
    expect(getCorpusForShape('sectionId')).toBe(DEFAULT_CORPUS.sectionIds);
    expect(getCorpusForShape('commandArgs')).toBe(DEFAULT_CORPUS.commandArgs);
    expect(getCorpusForShape('eventPayload')).toBe(DEFAULT_CORPUS.eventPayloads);
    expect(getCorpusForShape('none')).toBe(DEFAULT_CORPUS.none);
  });
});

describe('mergeCorpus', () => {
  it('returns defaults when user corpus is undefined', () => {
    expect(mergeCorpus(DEFAULT_CORPUS, undefined)).toBe(DEFAULT_CORPUS);
  });

  it('extends by default with a bare array', () => {
    const merged = mergeCorpus(DEFAULT_CORPUS, { verseIds: [99001001] });
    expect(merged.verseIds.length).toBe(DEFAULT_CORPUS.verseIds.length + 1);
    expect(merged.verseIds).toContain(99001001);
  });

  it('replaces when mode=replace', () => {
    const merged = mergeCorpus(DEFAULT_CORPUS, {
      mode: 'replace',
      verseIds: [99001001],
    });
    expect(merged.verseIds).toEqual([99001001]);
  });

  it('honors per-field {append} override', () => {
    const merged = mergeCorpus(DEFAULT_CORPUS, {
      mode: 'replace',
      referenceStrings: { append: ['Custom 1:1'] },
    });
    expect(merged.referenceStrings.length).toBe(
      DEFAULT_CORPUS.referenceStrings.length + 1,
    );
  });

  it('honors per-field {replace} override even under extend mode', () => {
    const merged = mergeCorpus(DEFAULT_CORPUS, {
      referenceStrings: { replace: ['Only One'] },
    });
    expect(merged.referenceStrings).toEqual(['Only One']);
  });

  it('leaves untouched fields equal to defaults', () => {
    const merged = mergeCorpus(DEFAULT_CORPUS, { verseIds: [99001001] });
    expect(merged.referenceStrings).toBe(DEFAULT_CORPUS.referenceStrings);
    expect(merged.storage).toBe(DEFAULT_CORPUS.storage);
  });
});

describe('validateUserCorpus', () => {
  it('accepts an empty object', () => {
    expect(validateUserCorpus({})).toEqual({});
  });

  it('accepts a well-formed corpus', () => {
    const parsed = validateUserCorpus({
      mode: 'extend',
      verseIds: [43003016, 45008028],
      verseRanges: [{ startVerseId: 43003016, endVerseId: 43003018 }],
      referenceStrings: { append: ['Jn iii 16'] },
      dictionaryKeys: ['G25'],
      storage: {
        replace: [{ id: 'fresh', description: 'x', entries: [['k', 'v']] }],
      },
      network: [
        { id: 'svc-up', kind: 'success', description: 'mock', status: 200 },
      ],
    });
    expect(parsed.verseIds).toEqual([43003016, 45008028]);
    expect(parsed.referenceStrings).toEqual({ append: ['Jn iii 16'] });
  });

  it('rejects non-object input', () => {
    expect(() => validateUserCorpus(null)).toThrow(CorpusValidationError);
    expect(() => validateUserCorpus([])).toThrow(CorpusValidationError);
    expect(() => validateUserCorpus('string')).toThrow(CorpusValidationError);
  });

  it('rejects unknown top-level fields', () => {
    expect(() => validateUserCorpus({ foo: [] })).toThrow(/unknown field/);
  });

  it('rejects invalid mode', () => {
    expect(() => validateUserCorpus({ mode: 'merge' })).toThrow(/mode/);
  });

  it('rejects non-integer verse ids', () => {
    expect(() => validateUserCorpus({ verseIds: [1.5] })).toThrow(/integer/);
  });

  it('rejects malformed verse range', () => {
    expect(() =>
      validateUserCorpus({ verseRanges: [{ startVerseId: 'x' }] }),
    ).toThrow(/integer/);
  });

  it('rejects storage fixture missing id', () => {
    expect(() =>
      validateUserCorpus({
        storage: [{ description: 'x', entries: [] } as unknown],
      }),
    ).toThrow(/id/);
  });

  it('rejects network fixture with unknown kind', () => {
    expect(() =>
      validateUserCorpus({
        network: [{ id: 'x', kind: 'weird', description: 'y' }],
      }),
    ).toThrow(/kind/);
  });

  it('rejects override object with extra keys', () => {
    expect(() =>
      validateUserCorpus({
        verseIds: { append: [], extras: [] },
      }),
    ).toThrow(/unknown key/);
  });

  it('merges a validated user corpus cleanly', () => {
    const parsed = validateUserCorpus({
      verseIds: [99001001],
      referenceStrings: { replace: ['Only One'] },
    });
    const merged = mergeCorpus(DEFAULT_CORPUS, parsed);
    expect(merged.verseIds).toContain(99001001);
    expect(merged.referenceStrings).toEqual(['Only One']);
  });
});
