import { describe, expect, it, vi } from 'vitest';

// `referenceScan` reads book names through i18n, which cannot load in this
// test environment; English names straight from the locale file are what it
// would return anyway.
vi.mock('../../../../i18n', async () => {
  const books = (await import('../../../../locales/en/books.json')).default as Record<string, string>;
  return { default: { t: (key: string, opts?: { defaultValue?: string }) => books[key] ?? opts?.defaultValue ?? key } };
});

import { createNotesDetector, detectNotes } from '../detect';
import { matchPhrase } from '../highlightMatch';
import type { ChapterLookup, DetectOptions, NotesBlock, NotesBlockKind, NotesMark, VerseText } from '../types';
import { LIBRARY } from './fixtures';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const JOHN_3: VerseText[] = [
  { verseId: 43003016, verse: 16, html: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
  { verseId: 43003017, verse: 17, html: 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.' },
  { verseId: 43003018, verse: 18, html: 'He that <i>believeth</i> on him is not condemned: but he that believeth not is condemned already.' },
];
const JOHN_4: VerseText[] = [
  { verseId: 43004001, verse: 1, html: 'When therefore the Lord knew how the Pharisees had heard that Jesus made and baptized more disciples than John,' },
];
const MATT_5: VerseText[] = [
  { verseId: 40005003, verse: 3, html: '<span class="christ-words">Blessed <i>are</i> the poor in spirit: for theirs is the kingdom of heaven.</span>' },
];

const CHAPTERS: Record<string, VerseText[]> = { 'KJV/43/3': JOHN_3, 'KJV/43/4': JOHN_4, 'KJV/40/5': MATT_5 };
const getChapter: ChapterLookup = (module, book, chapter) => CHAPTERS[`${module}/${book}/${chapter}`];

const OPTIONS: DetectOptions = { module: 'KJV', modules: ['KJV', 'ESV', 'NKJV'], hymns: LIBRARY, getChapter };

interface BlockSpec {
  text: string;
  kind?: NotesBlockKind;
  /** Substrings to mark bold (first occurrence, or the nth with `[text, n]`). */
  bold?: Array<string | [string, number]>;
  unlink?: string[];
  pin?: Array<{ text: string; attrs: NotesMark['attrs'] }>;
  group?: number;
}

function find(text: string, needle: string, nth = 1): { from: number; to: number } {
  let from = -1;
  for (let i = 0; i < nth; i++) from = text.indexOf(needle, from + 1);
  if (from < 0) throw new Error(`"${needle}" not in "${text}"`);
  return { from, to: from + needle.length };
}

/** Blocks with realistic positions: each textblock is its text plus two tokens. */
function doc(...specs: Array<string | BlockSpec>): NotesBlock[] {
  let pos = 0;
  return specs.map((raw, index) => {
    const spec = typeof raw === 'string' ? { text: raw } : raw;
    const marks: NotesMark[] = [
      ...(spec.bold ?? []).map(b => ({ ...(Array.isArray(b) ? find(spec.text, b[0], b[1]) : find(spec.text, b)), type: 'bold' as const })),
      ...(spec.unlink ?? []).map(u => ({ ...find(spec.text, u), type: 'unlink' as const })),
      ...(spec.pin ?? []).map(p => ({ ...find(spec.text, p.text), type: 'pin' as const, attrs: p.attrs })),
    ];
    const block: NotesBlock = { pos, id: `b${index}`, text: spec.text, kind: spec.kind ?? 'paragraph', marks };
    if (spec.group !== undefined) block.group = spec.group;
    pos += spec.text.length + 2;
    return block;
  });
}

const run = (blocks: NotesBlock[], options: Partial<DetectOptions> = {}) => detectNotes(blocks, { ...OPTIONS, ...options });
const summary = (blocks: NotesBlock[], options: Partial<DetectOptions> = {}) =>
  run(blocks, options).items.map(item => ({ label: item.label, status: item.status, item: item.item }));

// ---------------------------------------------------------------------------
// Passages
// ---------------------------------------------------------------------------

describe('passages', () => {
  it.each([
    ['John 3:16', { book: 43, chapter: 3, verseStart: 16 }, 'John 3:16'],
    ['Read Rom 8:28–39 together', { book: 45, chapter: 8, verseStart: 28, verseEnd: 39 }, 'Rom 8:28–39'],
    ['1 Cor 13 is the love chapter', { book: 46, chapter: 13 }, '1 Cor 13'],
    ['Then Ps. 23', { book: 19, chapter: 23 }, 'Ps. 23'],
    ['John   3:16 with odd spacing', { book: 43, chapter: 3, verseStart: 16 }, 'John 3:16'],
  ])('%s', (text, expected, label) => {
    const [item] = run(doc(text)).items;
    expect(item).toMatchObject({ kind: 'passage', status: 'ok', source: 'detected', label, item: { kind: 'passage', module: 'KJV', ...expected } });
    expect(text.slice(item.from, item.to).replace(/\s+/g, ' ')).toBe(label);
  });

  it('reads "John 1" as John, and "1 John 1" as 1 John', () => {
    expect(summary(doc('John 1 and 1 John 1')).map(s => s.item)).toEqual([
      { kind: 'passage', module: 'KJV', book: 43, chapter: 1 },
      { kind: 'passage', module: 'KJV', book: 62, chapter: 1 },
    ]);
  });

  it.each([
    ['John 3:16 (ESV)', 'ESV'],
    ['John 3:16 ESV', 'ESV'],
    ['John 3:16 (nkjv)', 'NKJV'],
    ['John 3:16 (XYZ)', 'KJV'],
    ['John 3:16 esv', 'KJV'],
  ])('translation: %s -> %s', (text, module) => {
    const [item] = run(doc(text)).items;
    expect(item.item).toMatchObject({ module });
    if (module !== 'KJV') expect(item.to).toBe(text.length);
  });

  it('accepts any parenthesised code when no module list is given', () => {
    expect(run(doc('John 3:16 (CSB)'), { modules: undefined }).items[0].item).toMatchObject({ module: 'CSB' });
  });

  it('keeps a repeated reference as two items with distinct ids', () => {
    const { items } = run(doc('John 3:16, and again John 3:16'));
    expect(items).toHaveLength(2);
    expect(items[0].id).not.toBe(items[1].id);
    expect(items[1].from).toBe('John 3:16, and again '.length);
  });

  it('runs a cross-chapter range to the end of its first chapter', () => {
    const [item] = run(doc('John 3:16–4:2')).items;
    expect(item).toMatchObject({ label: 'John 3:16–4:2', from: 0, to: 13, item: { book: 43, chapter: 3, verseStart: 16 } });
    expect(item.item).not.toHaveProperty('verseEnd');
  });

  it('ignores ordinary numbers', () => {
    expect(run(doc('In 2020, 3 events happened at 10:30.')).items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Continuations and sections
// ---------------------------------------------------------------------------

describe('continuations', () => {
  it.each([
    ['v. 18', { verseStart: 18 }, 'John 3:18'],
    ['vv. 17–18', { verseStart: 17, verseEnd: 18 }, 'John 3:17-18'],
    ['verse 18', { verseStart: 18 }, 'John 3:18'],
    ['see v18', { verseStart: 18 }, 'John 3:18'],
    ['verses 17-18 (ESV)', { verseStart: 17, verseEnd: 18, module: 'ESV' }, 'John 3:17-18'],
  ])('%s continues the passage above', (text, expected, label) => {
    const { items } = run(doc('John 3:16', 'Some prose.', text));
    expect(items[1]).toMatchObject({
      label, continuationOf: items[0].id, item: { kind: 'passage', module: 'KJV', book: 43, chapter: 3, ...expected },
    });
  });

  it('continues a continuation', () => {
    const { items } = run(doc('John 3:16', 'v. 17', 'v. 18'));
    expect(items.map(i => i.label)).toEqual(['John 3:16', 'John 3:17', 'John 3:18']);
  });

  it('continues a passage earlier in the same paragraph', () => {
    expect(summary(doc('John 3:16, then v. 18')).map(s => s.label)).toEqual(['John 3:16', 'John 3:18']);
  });

  it('is ignored with no passage above', () => {
    expect(run(doc('Look at v. 4', 'John 3:16')).items.map(i => i.label)).toEqual(['John 3:16']);
  });

  it('reaches back into the previous section', () => {
    const { items } = run(doc('John 3:16', 'prose', 'Hymn 460', 'prose', 'v. 18'));
    expect(items.map(i => i.label)).toEqual(['John 3:16', '460', 'John 3:18']);
  });

  it('does not reach two sections back: a stray v. 4 stays unattached', () => {
    const { items } = run(doc('Genesis 1', 'long prose', 'Hymn 460', 'Quote: "Grace is free." — Spurgeon', 'prose', 'v. 4'));
    expect(items.map(i => i.kind)).toEqual(['passage', 'hymn', 'quote']);
  });
});

describe('sections', () => {
  it('groups each item block with the prose after it', () => {
    const blocks = doc('Intro', 'John 3:16', 'prose', 'more prose', 'Hymn 460', 'end');
    const { sections, items } = run(blocks);
    expect(sections).toEqual([
      { blocks: [blocks[0].pos], itemIds: [] },
      { blocks: [blocks[1].pos, blocks[2].pos, blocks[3].pos], itemIds: [items[0].id] },
      { blocks: [blocks[4].pos, blocks[5].pos], itemIds: [items[1].id] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Hymns
// ---------------------------------------------------------------------------

describe('hymns', () => {
  it.each([
    ['Hymn: Amazing Grace (verses 1, 2, 5)', 'ok', { kind: 'hymn', hymnId: 'amazing-grace', verseOrder: ['1', '2', '5'] }],
    ['Hymn – It Is Well v1-3', 'ok', { kind: 'hymn', hymnId: 'it-is-well', verseOrder: ['1', 'R', '2', 'R', '3', 'R'] }],
    ['Hymn: It Is Well (1, R, 4)', 'ok', { kind: 'hymn', hymnId: 'it-is-well', verseOrder: ['1', 'R', '4'] }],
    ['Hymn 460', 'ok', { kind: 'hymn', hymnId: 'amazing-grace' }],
    ['Hymn: Zebra Crossing Blues', 'choose', null],
    ['Hymn: Grace', 'choose', null],
  ])('%s', (text, status, item) => {
    expect(summary(doc(text))).toEqual([expect.objectContaining({ status, item })]);
  });

  it('explains an ambiguous title', () => {
    const [item] = run(doc('Hymn: Grace')).items;
    expect(item.reason).toEqual({ key: 'present.notes.reason.hymnAmbiguous', params: { title: 'Grace' } });
    expect(item.candidates?.length).toBeGreaterThan(1);
  });

  it('treats "Song of Solomon 2:4" as a passage, not a hymn', () => {
    expect(run(doc('Song of Solomon 2:4')).items[0]).toMatchObject({ kind: 'passage', item: { book: 22, chapter: 2, verseStart: 4 } });
  });

  it('does not read references or continuations inside a hymn line', () => {
    expect(run(doc('John 3:16', 'Hymn 460 (verses 1, 2)')).items.map(i => i.kind)).toEqual(['passage', 'hymn']);
  });

  it('finds a hymn on its own line within a block', () => {
    const text = 'Prayer\nHymn 460\nJohn 3:16';
    const { items } = run(doc(text));
    expect(items.map(i => [i.kind, text.slice(i.from, i.to)])).toEqual([['hymn', 'Hymn 460'], ['passage', 'John 3:16']]);
  });

  it('needs a choice when there is no library', () => {
    expect(run(doc('Hymn 460'), { hymns: undefined }).items[0]).toMatchObject({ status: 'choose', item: null });
  });
});

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

describe('quotes', () => {
  it.each([
    ['Quote: "Grace is free." — Spurgeon', { text: 'Grace is free.', attribution: 'Spurgeon' }],
    ['Quote: “Grace is free.” -- C. H. Spurgeon', { text: 'Grace is free.', attribution: 'C. H. Spurgeon' }],
    ['Quote: Grace is free.\n— Spurgeon', { text: 'Grace is free.', attribution: 'Spurgeon' }],
    ['Quote - Grace is free.', { text: 'Grace is free.' }],
  ])('%s', (text, expected) => {
    expect(run(doc(text)).items).toEqual([expect.objectContaining({ kind: 'quote', item: { kind: 'quote', ...expected } })]);
  });

  it('reads a blockquote of several paragraphs as one quote, attribution last', () => {
    const blocks = doc(
      { text: 'The chief end of man', kind: 'blockquote', group: 1 },
      { text: 'is to glorify God.', kind: 'blockquote', group: 1 },
      { text: '— Westminster Shorter Catechism', kind: 'blockquote', group: 1 },
      'prose',
    );
    const { items, sections } = run(blocks);
    expect(items).toEqual([expect.objectContaining({
      kind: 'quote', blockPos: blocks[0].pos, endBlockPos: blocks[2].pos,
      item: { kind: 'quote', text: 'The chief end of man\nis to glorify God.', attribution: 'Westminster Shorter Catechism' },
    })]);
    expect(sections).toEqual([{ blocks: blocks.map(b => b.pos), itemIds: [items[0].id] }]);
  });

  it('keeps separate blockquotes apart', () => {
    const blocks = doc({ text: 'One.', kind: 'blockquote', group: 1 }, { text: 'Two.', kind: 'blockquote', group: 2 });
    expect(run(blocks).items.map(i => i.item)).toEqual([{ kind: 'quote', text: 'One.' }, { kind: 'quote', text: 'Two.' }]);
  });

  it('does not find references inside a blockquote', () => {
    expect(run(doc({ text: 'For God so loved the world (John 3:16)', kind: 'blockquote' })).items.map(i => i.kind)).toEqual(['quote']);
  });
});

// ---------------------------------------------------------------------------
// Bold highlights
// ---------------------------------------------------------------------------

describe('bold highlights', () => {
  const highlightOf = (blocks: NotesBlock[], options: Partial<DetectOptions> = {}) => run(blocks, options).highlights;

  it.each([
    ['one word', 'everlasting', { verseIdStart: 43003016, textStart: 23 }],
    ['a phrase', 'everlasting life', { verseIdStart: 43003016, textStart: 23, textEnd: 24 }],
    ['case and punctuation ignored', 'LOVED THE WORLD!', { verseIdStart: 43003016, textStart: 3, textEnd: 5 }],
    ['a repeated word matches its first occurrence', 'that', { verseIdStart: 43003016, textStart: 6 }],
  ])('%s', (_name, bold, range) => {
    const [h] = highlightOf(doc('John 3:16', { text: `Note: ${bold}`, bold: [bold] }));
    expect(h).toMatchObject({ status: 'ok', range, text: bold });
  });

  it('matches the first verse of a range that has the words', () => {
    const [h] = highlightOf(doc('John 3:16-18', { text: 'condemned', bold: ['condemned'] }));
    expect(h.range).toEqual({ verseIdStart: 43003018, textStart: 7 });
  });

  it('matches across a verse boundary', () => {
    const [h] = highlightOf(doc('John 3:16-17', { text: 'everlasting life. For God sent', bold: ['everlasting life. For God sent'] }));
    expect(h.range).toEqual({ verseIdStart: 43003016, textStart: 23, verseIdEnd: 43003017, textEnd: 2 });
  });

  it('only searches the verse cited, not the whole chapter', () => {
    const [h] = highlightOf(doc('John 3:16', { text: 'condemned', bold: ['condemned'] }));
    expect(h).toMatchObject({
      status: 'choose', range: null,
      reason: { key: 'present.notes.reason.notFoundInPassage', params: { ref: 'John 3:16', text: 'condemned' } },
    });
  });

  it('searches the whole chapter for a chapter reference', () => {
    expect(highlightOf(doc('John 3', { text: 'sent not', bold: ['sent not'] }))[0].range).toEqual({ verseIdStart: 43003017, textStart: 2, textEnd: 3 });
  });

  it('uses the viewer’s word indices through formatting tags', () => {
    const [h] = highlightOf(doc('Matt 5:3', { text: 'poor in spirit', bold: ['poor in spirit'] }));
    expect(h.range).toEqual({ verseIdStart: 40005003, textStart: 3, textEnd: 5 });
  });

  it('matches whole words only', () => {
    expect(highlightOf(doc('John 3:16', { text: 'love', bold: ['love'] }))[0]).toMatchObject({ status: 'choose', range: null });
  });

  it('attaches to the nearest passage above, including a continuation', () => {
    const { items, highlights } = run(doc('John 3:16', 'v. 18', { text: 'condemned', bold: ['condemned'] }));
    expect(highlights[0]).toMatchObject({ itemId: items[1].id, status: 'ok', range: { verseIdStart: 43003018 } });
  });

  it('uses only passages before it in the same paragraph', () => {
    const blocks = doc({ text: 'everlasting — John 3:16 — everlasting', bold: [['everlasting', 1], ['everlasting', 2]] });
    const [before, after] = run(blocks).highlights;
    expect(before).toMatchObject({ status: 'choose', itemId: null, reason: { key: 'present.notes.reason.noPassage' } });
    expect(after).toMatchObject({ status: 'ok' });
  });

  it('is not a highlight when the bold is the reference itself', () => {
    expect(highlightOf(doc({ text: 'John 3:16', bold: ['John 3:16'] }))).toEqual([]);
  });

  it('merges adjacent bold marks into one phrase', () => {
    const text = 'everlasting life';
    const blocks = doc('John 3:16', { text });
    blocks[1].marks = [{ from: 0, to: 12, type: 'bold' }, { from: 12, to: 16, type: 'bold' }];
    expect(run(blocks).highlights).toHaveLength(1);
  });

  it('is pending, and asks for the chapter, until the verse text is loaded', () => {
    const result = run(doc('John 3:16', { text: 'loved', bold: ['loved'] }), { getChapter: () => undefined });
    expect(result.highlights[0]).toMatchObject({ status: 'pending', range: null });
    expect(result.needsChapters).toEqual([{ module: 'KJV', book: 43, chapter: 3 }]);
  });

  it('does not reach two sections back', () => {
    const blocks = doc('John 3:16', 'Hymn 460', 'Quote: "x" — y', { text: 'loved', bold: ['loved'] });
    expect(run(blocks).highlights[0]).toMatchObject({ itemId: null, status: 'choose' });
  });
});

// ---------------------------------------------------------------------------
// pin and unlink
// ---------------------------------------------------------------------------

describe('pin and unlink', () => {
  it('unlink suppresses a reference', () => {
    expect(run(doc({ text: 'John 3:16 and Rom 8:28', unlink: ['John 3:16'] })).items.map(i => i.label)).toEqual(['Rom 8:28']);
  });

  it('unlink suppresses a hymn line and a bold highlight', () => {
    const blocks = doc('John 3:16', { text: 'Hymn 460', unlink: ['Hymn'] }, { text: 'loved', bold: ['loved'], unlink: ['loved'] });
    const result = run(blocks);
    expect(result.items.map(i => i.kind)).toEqual(['passage']);
    expect(result.highlights).toEqual([]);
  });

  it('unlink suppresses a blockquote', () => {
    expect(run(doc({ text: 'Not a quote', kind: 'blockquote', unlink: ['Not'] })).items).toEqual([]);
  });

  it('a pinned item overrides fuzzy matching', () => {
    const pinned = { kind: 'hymn' as const, hymnId: 'grace-greater', verseOrder: ['1', 'R'] };
    const [item] = run(doc({ text: 'Hymn: Grace', pin: [{ text: 'Hymn: Grace', attrs: { item: pinned } }] })).items;
    expect(item).toMatchObject({ kind: 'hymn', status: 'ok', source: 'pinned', item: pinned });
  });

  it('a pin can make an item of plain text', () => {
    const pinned = { kind: 'text' as const, body: 'Welcome!' };
    expect(run(doc({ text: 'Welcome slide here', pin: [{ text: 'Welcome slide', attrs: { item: pinned } }] })).items)
      .toEqual([expect.objectContaining({ source: 'pinned', from: 0, to: 13, item: pinned })]);
  });

  it('a pinned range overrides the word match; a null range removes the highlight', () => {
    const range = { verseIdStart: 43003016, textStart: 1 };
    const blocks = doc('John 3:16', {
      text: 'loved and world', bold: ['loved', 'world'],
      pin: [{ text: 'loved', attrs: { range } }, { text: 'world', attrs: { range: null } }],
    });
    expect(run(blocks).highlights).toEqual([expect.objectContaining({ text: 'loved', range, source: 'pinned', status: 'ok' })]);
  });
});

// ---------------------------------------------------------------------------
// Ids and incremental re-runs
// ---------------------------------------------------------------------------

describe('incremental detection', () => {
  it('keeps item ids stable when text is typed above', () => {
    const before = run(doc('Intro', 'John 3:16'));
    const after = run(doc('Intro with more words', 'John 3:16'));
    expect(after.items[0].id).toBe(before.items[0].id);
    expect(after.items[0].blockPos).not.toBe(before.items[0].blockPos);
  });

  it('re-scans only blocks whose text changed', async () => {
    const referenceScan = await import('../../../../present/referenceScan');
    const spy = vi.spyOn(referenceScan, 'scanReferences');
    const detector = createNotesDetector();
    detector.detect(doc('John 3:16', 'Rom 8:28', 'prose'), OPTIONS);
    const firstCalls = spy.mock.calls.length;
    spy.mockClear();
    const result = detector.detect(doc('John 3:16', 'Rom 8:28 changed', 'prose'), OPTIONS);
    expect(result.items.map(i => i.label)).toEqual(['John 3:16', 'Rom 8:28']);
    expect(firstCalls).toBeGreaterThan(spy.mock.calls.length);
    expect(spy.mock.calls.every(([text]) => text.includes('changed'))).toBe(true);
    spy.mockRestore();
  });

  it('settles pending highlights on a re-run once chapters load', () => {
    const detector = createNotesDetector();
    const blocks = doc('John 3:16', { text: 'loved', bold: ['loved'] });
    const loaded = new Map<string, VerseText[]>();
    const lookup: ChapterLookup = (m, b, c) => loaded.get(`${m}/${b}/${c}`);
    const first = detector.detect(blocks, { ...OPTIONS, getChapter: lookup });
    for (const ch of first.needsChapters) loaded.set(`${ch.module}/${ch.book}/${ch.chapter}`, CHAPTERS[`${ch.module}/${ch.book}/${ch.chapter}`]);
    const second = detector.detect(blocks, { ...OPTIONS, getChapter: lookup });
    expect(second.highlights[0]).toMatchObject({ status: 'ok', range: { verseIdStart: 43003016, textStart: 3 } });
    expect(second.needsChapters).toEqual([]);
  });
});

describe('matchPhrase', () => {
  it('returns null for an empty phrase', () => {
    expect(matchPhrase(' — ', JOHN_3)).toBeNull();
  });
});
