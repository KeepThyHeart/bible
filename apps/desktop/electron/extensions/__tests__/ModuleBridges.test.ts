/**
 * Production CommentaryBridge / DictionaryBridge / BookBridge unit tests.
 *
 * Each bridge is driven against a tiny stub repository so the tests can
 * exercise marshaling without standing up a real SQLite module.
 */

import { describe, it, expect } from 'vitest';
import {
  CommentaryEntry,
  DictionaryEntry,
  BookSection,
} from '@bible/core';
import type {
  CommentaryRepository,
  DictionaryRepository,
  BookRepository,
} from '@bible/core';

import { CommentaryBridge } from '../bridges/CommentaryBridge';
import { DictionaryBridge } from '../bridges/DictionaryBridge';
import { BookBridge } from '../bridges/BookBridge';

// --- CommentaryBridge ------------------------------------------------------

describe('CommentaryBridge', () => {
  function makeRepo(entries: CommentaryEntry[]): CommentaryRepository {
    return {
      getEntriesForVerse: (verseId: number) =>
        entries.filter(
          (e) => (e.verseIdStart ?? 0) <= verseId && verseId <= (e.verseIdEnd ?? e.verseIdStart ?? 0),
        ),
      getEntriesForRange: (start: number, end: number) =>
        entries.filter(
          (e) => (e.verseIdEnd ?? e.verseIdStart ?? 0) >= start && (e.verseIdStart ?? 0) <= end,
        ),
    } as unknown as CommentaryRepository;
  }

  const sampleEntry = new CommentaryEntry({
    entryId: 7,
    verseIdStart: 43003016,
    verseIdEnd: 43003016,
    entryLevel: 'verse',
    content: '<p>For God so loved…</p>',
    metadata: { source: 'henry' },
  });

  const baseDeps = {
    getCommentaryRepository: (_abbr: string) => makeRepo([sampleEntry]),
    listCommentaryModules: () => [
      { moduleId: 'henry', abbreviation: 'henry', moduleName: 'Matthew Henry', languageCode: 'en' },
    ],
  };

  it('marshals an entry to a CommentaryEntryDto', () => {
    const bridge = new CommentaryBridge(baseDeps);
    const dto = bridge.getEntry('henry', 43003016)!;
    expect(dto).toMatchObject({
      id: '7',
      moduleId: 'henry',
      startVerseId: 43003016,
      endVerseId: 43003016,
      content: '<p>For God so loved…</p>',
      isHtml: true,
      metadata: { source: 'henry' },
    });
  });

  it('returns null when no entry covers the verse', () => {
    const bridge = new CommentaryBridge(baseDeps);
    expect(bridge.getEntry('henry', 1)).toBeNull();
  });

  it('returns null when the module is unknown', () => {
    const bridge = new CommentaryBridge({
      ...baseDeps,
      getCommentaryRepository: () => null,
    });
    expect(bridge.getEntry('missing', 43003016)).toBeNull();
    expect(bridge.getEntriesForRange('missing', 1, 100)).toEqual([]);
  });

  it('lists modules with abbreviation as id fallback', () => {
    const bridge = new CommentaryBridge(baseDeps);
    expect(bridge.listModules()).toEqual([
      { id: 'henry', abbreviation: 'henry', name: 'Matthew Henry', language: 'en' },
    ]);
  });
});

// --- DictionaryBridge ------------------------------------------------------

describe('DictionaryBridge', () => {
  function makeRepo(entries: DictionaryEntry[]): DictionaryRepository {
    return {
      getEntryByKey: (key: string) => entries.find((e) => e.entryKey === key),
      searchEntries: (query: string, opts?: { limit?: number }) => {
        const q = query.toLowerCase();
        const matches = entries.filter(
          (e) =>
            (e.word ?? '').toLowerCase().includes(q) ||
            e.definition.toLowerCase().includes(q),
        );
        return opts?.limit ? matches.slice(0, opts.limit) : matches;
      },
    } as unknown as DictionaryRepository;
  }

  const greek = new DictionaryEntry({
    entryKey: 'G25',
    word: 'agapao',
    pronunciation: 'ag-ap-ah-o',
    definition: 'to love (in a social or moral sense)',
  });

  const baseDeps = {
    getDictionaryRepository: (_abbr: string) => makeRepo([greek]),
    listDictionaryModules: () => [
      { moduleId: 'strongs', abbreviation: 'STR', moduleName: "Strong's" },
    ],
  };

  it('marshals a Strong entry into a DictionaryEntryDto with language hint', () => {
    const bridge = new DictionaryBridge(baseDeps);
    const dto = bridge.lookup('strongs', 'G25')!;
    expect(dto).toMatchObject({
      key: 'G25',
      moduleId: 'strongs',
      headword: 'agapao',
      content: 'to love (in a social or moral sense)',
      isHtml: true,
      pronunciation: 'ag-ap-ah-o',
      strongsNumber: 'G25',
      language: 'el',
    });
  });

  it('returns null for unknown keys', () => {
    const bridge = new DictionaryBridge(baseDeps);
    expect(bridge.lookup('strongs', 'X999')).toBeNull();
  });

  it('honors the search limit', () => {
    const bridge = new DictionaryBridge(baseDeps);
    expect(bridge.search('strongs', 'love', 5)).toHaveLength(1);
  });
});

// --- BookBridge ------------------------------------------------------------

describe('BookBridge', () => {
  const root = new BookSection({
    sectionId: 1,
    sectionNumber: '1',
    title: 'Foreword',
    content: '<p>Welcome.</p>',
  });
  const child = new BookSection({
    sectionId: 2,
    parentSectionId: 1,
    sectionNumber: '1.1',
    title: 'Acknowledgements',
    content: 'Thanks!',
  });

  function makeRepo(): BookRepository {
    return {
      getSection: (id: number) => (id === 1 ? root : id === 2 ? child : undefined),
      getTopLevelSections: () => [root],
      getSectionsByParent: (parent: number) => (parent === 1 ? [child] : []),
    } as unknown as BookRepository;
  }

  const baseDeps = {
    getBookRepository: (_abbr: string) => makeRepo(),
    listBookModules: () => [
      { moduleId: 'pilgrim', abbreviation: 'pilgrim', moduleName: "Pilgrim's Progress" },
    ],
  };

  it('marshals a section into a BookSectionDto', () => {
    const bridge = new BookBridge(baseDeps);
    const dto = bridge.getSection('pilgrim', '1')!;
    expect(dto).toMatchObject({
      id: '1',
      moduleId: 'pilgrim',
      title: 'Foreword',
      depth: 1,
      hasChildren: true,
      content: '<p>Welcome.</p>',
      isHtml: true,
    });
  });

  it('returns null when sectionId is not numeric', () => {
    const bridge = new BookBridge(baseDeps);
    expect(bridge.getSection('pilgrim', 'not-a-number')).toBeNull();
  });

  it('lists top-level sections when parentId is omitted', () => {
    const bridge = new BookBridge(baseDeps);
    const summaries = bridge.listSections('pilgrim');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: '1',
      title: 'Foreword',
      depth: 1,
      hasChildren: true,
      order: 0,
    });
  });

  it('lists child sections under a parentId', () => {
    const bridge = new BookBridge(baseDeps);
    const summaries = bridge.listSections('pilgrim', '1');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: '2',
      parentId: '1',
      title: 'Acknowledgements',
      depth: 2,
      hasChildren: false,
    });
  });
});
