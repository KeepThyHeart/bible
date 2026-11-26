import { describe, it, expect } from 'vitest';
import { ReferenceEngine } from '@bible/core';
import { parsePassageList, rangeToIds } from './parsePassageList';

const engine = ReferenceEngine.create({ locales: ['en'] });
const parse = (t: string, canonical = false) => parsePassageList(t, { engine, canonical });
const ids = (t: string, canonical = false) => parse(t, canonical).passages.map((p) => [p.startId, p.endId]);

describe('parsePassageList', () => {
  it('reads three specs in typed order, whole chapter for a bare chapter', () => {
    const r = parse('Rom 7:24-8:4; 1 Cor 15:50-58, Isa 53');
    expect(r.unrecognized).toEqual([]);
    expect(r.passages.map((p) => [p.book, p.startId, p.endId])).toEqual([
      [45, 45007024, 45008004],
      [46, 46015050, 46015058],
      [23, 23053001, 23053999],
    ]);
    expect(r.passages[2].label).toMatch(/Isaiah 53/);
  });

  it('splits "Rom 8:1, 3" into two verses of Romans 8', () => {
    expect(ids('Rom 8:1, 3')).toEqual([[45008001, 45008001], [45008003, 45008003]]);
  });

  it('accepts lower case', () => {
    expect(ids('rom 8')).toEqual([[45008001, 45008999]]);
  });

  it('reads "Ps 23, 24" as two chapters (gap pass)', () => {
    expect(ids('Ps 23, 24')).toEqual([[19023001, 19023999], [19024001, 19024999]]);
  });

  it('reads a bare single-chapter book', () => {
    const r = parse('Jude');
    expect(r.unrecognized).toEqual([]);
    expect(r.passages).toHaveLength(1);
    expect(r.passages[0].startId).toBe(65001001);
    expect(r.passages[0].endId).toBe(65001999);
  });

  it('reports unrecognized text but keeps the rest', () => {
    const r = parse('foo; Rom 8');
    expect(r.unrecognized).toEqual(['foo']);
    expect(r.passages.map((p) => p.startId)).toEqual([45008001]);
  });

  it('handles full-width and mixed separators and "and"', () => {
    expect(ids('Rom 8；Jude and John 3').map((x) => x[0])).toEqual([45008001, 65001001, 43003001]);
    expect(parse('Rom 8 ; ; ,').unrecognized).toEqual([]);
  });

  it('keeps typed order, canonical sorts by start id (stable, repeats kept)', () => {
    expect(ids('John 3; Gen 1; John 3').map((x) => x[0])).toEqual([43003001, 1001001, 43003001]);
    expect(ids('John 3; Gen 1; John 3', true).map((x) => x[0])).toEqual([1001001, 43003001, 43003001]);
  });

  it('empty text gives nothing', () => {
    expect(parse('  ')).toEqual({ passages: [], unrecognized: [] });
  });
});

describe('rangeToIds', () => {
  it('chapter range and cross-chapter range', () => {
    expect(rangeToIds({ book: 43, chapter: 3, endVerse: 5 } as never)).toEqual({ startId: 43003001, endId: 43005999 });
    expect(rangeToIds({ book: 43, chapter: 3, verse: 16, endChapter: 4 } as never)).toEqual({ startId: 43003016, endId: 43004999 });
  });
  it('backwards range collapses; bad book is null', () => {
    expect(rangeToIds({ book: 43, chapter: 3, verse: 16, endVerse: 2 } as never)).toEqual({ startId: 43003016, endId: 43003016 });
    expect(rangeToIds({ book: 99, chapter: 1 } as never)).toBeNull();
  });
});
