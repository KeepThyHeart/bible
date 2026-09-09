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
    // Real KJV verse counts. John has 21 chapters; only the ones the tests
    // assert on are listed, because a wrong count here would make an assertion
    // pass against fiction.
    listChapterVerseCounts: (bookNumber: number) =>
      bookNumber === 43
        ? [
            { chapter: 1, verseCount: 51 },
            { chapter: 2, verseCount: 25 },
            { chapter: 3, verseCount: 36 },
          ]
        : [],
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

  // --- Structured formatting -------------------------------------------

  // Psalm 1:1 as the format actually stores it: one verse, three poetic lines,
  // the indent changing between them. This is the case the legacy
  // `poetry.indentLevel` cannot represent at all - it has room for one indent
  // and no line breaks - so it is the case worth pinning.
  const psalm1_1Text =
    'Blessed is the man that walketh not in the counsel of the ungodly, ' +
    'nor standeth in the way of sinners, nor sitteth in the seat of the scornful.';

  const psalm1_1 = new BibleVerse({
    verseId: 19001001,
    text: psalm1_1Text,
    formatting: {
      v: 1,
      block: {
        lines: [
          { start: 0, end: 12, level: 1 },
          { start: 13, end: 19, level: 2 },
          { start: 20, end: 27, level: 3 },
        ],
      },
    },
  });

  it('carries multi-line poetry across the bridge with every line intact', () => {
    const bridge = new BibleBridge({
      ...baseDeps,
      getBibleRepository: () => makeRepo([psalm1_1]),
    });
    const dto = bridge.getVerse(19001001)!;

    expect(dto.formatting?.block?.lines).toEqual([
      { start: 0, end: 12, level: 1 },
      { start: 13, end: 19, level: 2 },
      { start: 20, end: 27, level: 3 },
    ]);
    // The line ranges must cover the real verse, not an invented word count:
    // 28 whitespace-delimited words, indices 0..27.
    expect(psalm1_1Text.split(/\s+/)).toHaveLength(28);
    expect(dto.formatting!.block!.lines!.at(-1)!.end).toBe(27);
  });

  it('still populates the legacy shape for extensions written against 1.0.0', () => {
    const bridge = new BibleBridge({
      ...baseDeps,
      getBibleRepository: () => makeRepo([psalm1_1]),
    });
    const dto = bridge.getVerse(19001001)!;

    // The legacy view keeps saying what it always said - poetry, opening
    // indent - and loses the other two lines, which is precisely why the
    // structured payload exists alongside it rather than replacing it.
    expect(dto.formattingData?.poetry).toEqual({ isPoetry: true, indentLevel: 1 });
  });

  it('distinguishes a psalm superscription from an editorial section heading', () => {
    // Psalm 3's superscription and Matthew 5's editorial heading are the same
    // string field in the legacy shape, so nothing downstream could tell them
    // apart - and emitting USFM `\d` for "The Beatitudes" is invalid markup.
    const psalmTitle = new BibleVerse({
      verseId: 19003001,
      text: 'LORD, how are they increased that trouble me!',
      formatting: {
        v: 1,
        block: {
          heading: 'A Psalm of David, when he fled from Absalom his son.',
          heading_kind: 'psalm_title',
        },
      },
    });
    const sectionHeading = new BibleVerse({
      verseId: 40005003,
      text: 'Blessed are the poor in spirit',
      formatting: {
        v: 1,
        block: { heading: 'The Beatitudes', heading_kind: 'section' },
      },
    });

    const bridge = new BibleBridge({
      ...baseDeps,
      getBibleRepository: () => makeRepo([psalmTitle, sectionHeading]),
    });

    expect(bridge.getVerse(19003001)!.formatting?.block?.heading_kind).toBe('psalm_title');
    expect(bridge.getVerse(40005003)!.formatting?.block?.heading_kind).toBe('section');
    // Both still surface through the legacy field, undifferentiated.
    expect(bridge.getVerse(19003001)!.formattingData?.sectionHeading).toBe(
      'A Psalm of David, when he fled from Absalom his son.',
    );
  });

  it('leaves heading_kind absent when the module never recorded one', () => {
    // A module converted from legacy HTML used `<b>` for both kinds, so it has
    // a heading and no idea which kind it is. That third state must survive the
    // bridge: collapsing it to 'section' would be the host inventing data.
    const converted = new BibleVerse({
      verseId: 19004001,
      text: 'Hear me when I call, O God of my righteousness',
      formattingData: { sectionHeading: 'To the chief Musician on Neginoth' },
    });
    const bridge = new BibleBridge({
      ...baseDeps,
      getBibleRepository: () => makeRepo([converted]),
    });
    const block = bridge.getVerse(19004001)!.formatting?.block;

    expect(block?.heading).toBe('To the chief Musician on Neginoth');
    expect(block && 'heading_kind' in block).toBe(false);
  });

  it('hands out a structured-cloneable copy, not a reference into the model', () => {
    const bridge = new BibleBridge({
      ...baseDeps,
      getBibleRepository: () => makeRepo([psalm1_1]),
    });
    const dto = bridge.getVerse(19001001)!;

    // Crosses the RPC boundary by structured clone, so it must survive one
    // unchanged - no class instances, no frozen exotic objects.
    expect(structuredClone(dto)).toEqual(dto);
    // And it must not alias the repository's cached verse: an in-process
    // consumer editing the DTO would otherwise corrupt the next reader's verse.
    expect(dto.formatting!.block!.lines).not.toBe(psalm1_1.formatting.block!.lines);
  });

  it('omits formatting entirely for a verse that carries none', () => {
    const bridge = new BibleBridge(baseDeps);
    expect(bridge.getVerse(43003016)!.formatting).toBeUndefined();
  });

  // --- Chapter extents ---------------------------------------------------

  it('reports real chapter extents with inclusive verse-id bounds', () => {
    const bridge = new BibleBridge(baseDeps);
    const chapters = bridge.listChapters(43);

    expect(chapters).toEqual([
      { bookNumber: 43, chapter: 1, verseCount: 51, firstVerseId: 43001001, lastVerseId: 43001051 },
      { bookNumber: 43, chapter: 2, verseCount: 25, firstVerseId: 43002001, lastVerseId: 43002025 },
      { bookNumber: 43, chapter: 3, verseCount: 36, firstVerseId: 43003001, lastVerseId: 43003036 },
    ]);
    // John 3:36 is the last verse of John 3 - the number an extension needs to
    // pass as `verseIdEnd` to add the whole chapter to a plan.
    expect(chapters[2]!.lastVerseId).toBe(43003036);
  });

  it('returns an empty list for a book with no chapter data', () => {
    const bridge = new BibleBridge(baseDeps);
    expect(bridge.listChapters(66)).toEqual([]);
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
