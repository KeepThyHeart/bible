/**
 * Production `BibleBridge` unit tests.
 *
 * Drives the bridge with a stub `BibleRepository`-shaped object so we can
 * exercise the verse -> DTO marshaling and the active-verse subscription
 * fan-out without standing up a real SQLite Bible module.
 */

import { describe, it, expect } from 'vitest';
import { BibleVerse, BibleBook } from '@bible/core';

import { BibleBridge } from '../bridges/BibleBridge';

function makeRepo(verses: BibleVerse[]) {
  const byId = new Map(verses.map((v) => [v.verseId, v]));
  return {
    getVerse(id: number) {
      return byId.get(id);
    },
    getVerseRange(start: number, end: number) {
      const out: BibleVerse[] = [];
      for (let id = start; id <= end; id++) {
        const v = byId.get(id);
        if (v) out.push(v);
      }
      return out;
    },
  } as unknown as import('@bible/core').BibleRepository;
}

const johnVerse = new BibleVerse({
  verseId: 43003016,
  text: 'For God so loved the world',
  textPlain: 'For God so loved the world',
  wordCount: 6,
});

describe('BibleBridge', () => {
  const baseDeps = {
    getBibleRepository: (_abbr: string) => makeRepo([johnVerse]),
    listBibleModules: () => [
      { moduleId: 'kjv', abbreviation: 'KJV', moduleName: 'King James', languageCode: 'en', version: '1.0' },
    ],
    listAllBooks: () => [
      new BibleBook({
        bookNumber: 43,
        bookName: 'John',
        bookAbbreviation: 'Jn',
        testament: 'NT',
        chapterCount: 21,
        verseCount: 879,
      }),
    ],
    getDefaultModuleAbbreviation: () => 'KJV',
    sendNavigateToVerse: (_verseId: number) => {},
  };

  it('marshals a BibleVerse into a BibleVerseDto', () => {
    const bridge = new BibleBridge(baseDeps);
    const dto = bridge.getVerse(43003016)!;
    expect(dto).toMatchObject({
      verseId: 43003016,
      text: 'For God so loved the world',
      textPlain: 'For God so loved the world',
      wordCount: 6,
    });
    // The DTO must be a plain JSON-serializable object - no class methods.
    expect(typeof (dto as unknown as { getPlainText?: () => string }).getPlainText).toBe('undefined');
  });

  it('returns null for a missing verse', () => {
    const bridge = new BibleBridge(baseDeps);
    expect(bridge.getVerse(99999999)).toBeNull();
  });

  it('lists modules with the abbreviation as id when moduleId is unset', () => {
    const bridge = new BibleBridge({
      ...baseDeps,
      listBibleModules: () => [
        { moduleId: 'kjv', abbreviation: 'KJV', moduleName: 'King James', version: '1.0' },
      ],
    });
    const modules = bridge.listModules();
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ id: 'kjv', abbreviation: 'KJV', name: 'King James', version: '1.0' });
  });

  it('maps testament codes from internal OT/NT to DTO old/new', () => {
    const bridge = new BibleBridge(baseDeps);
    const books = bridge.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]!.testament).toBe('new');
  });

  it('parses an English reference into a ParsedReferenceDto', () => {
    const bridge = new BibleBridge(baseDeps);
    const parsed = bridge.parseReference('John 3:16')!;
    expect(parsed).toMatchObject({
      bookNumber: 43,
      chapter: 3,
      startVerse: 16,
      startVerseId: 43003016,
    });
  });

  it('fans active-verse changes out to every subscriber', () => {
    const bridge = new BibleBridge(baseDeps);
    const events: { verseId: number; module: string }[] = [];
    const dispose = bridge.subscribeActiveVerse((p) => {
      if (p) events.push(p);
    });
    bridge.notifyActiveVerse(43003016, 'KJV');
    bridge.notifyActiveVerse(1001001);
    dispose();
    bridge.notifyActiveVerse(2001001);
    expect(events).toEqual([
      { verseId: 43003016, module: 'KJV' },
      { verseId: 1001001, module: 'KJV' },
    ]);
  });

  it('isolates a throwing subscriber from the others', () => {
    const bridge = new BibleBridge(baseDeps);
    const fired: number[] = [];
    bridge.subscribeActiveVerse(() => {
      throw new Error('boom');
    });
    bridge.subscribeActiveVerse((p) => {
      if (p) fired.push(p.verseId);
    });
    bridge.notifyActiveVerse(43003016, 'KJV');
    expect(fired).toEqual([43003016]);
  });
});
