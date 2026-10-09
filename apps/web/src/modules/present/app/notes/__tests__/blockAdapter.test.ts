import { describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
vi.mock('../../../../../i18n', async () => {
  const books = (await import('../../../../../locales/en/books.json')).default as Record<string, string>;
  return { default: { t: (key: string, opts?: { defaultValue?: string }) => books[key] ?? opts?.defaultValue ?? key } };
});

import { docToBlocks } from '../editor/docToBlocks';
import { appendPinnedParagraph } from '../editor/commands';
import { assignBlockIds, withBlockIds } from '../editor/blockIds';
import { emptyDocJSON, notesSchema as s } from '../editor/schema';
import { buildVerseOrder } from '../verseOrder';
import { detectNotes } from '../detect';

const para = (text: string, blockId: string | null = null) => s.node('paragraph', { blockId }, text ? s.text(text) : undefined);

describe('docToBlocks -> NotesBlock', () => {
  it('carries blockId and groups blockquote paragraphs by quote', () => {
    const doc = s.node('doc', null, [
      para('intro', 'a'),
      s.node('blockquote', null, [para('one', 'q1'), para('two', 'q2')]),
      s.node('blockquote', null, [para('three', 'q3')]),
    ]);
    const blocks = docToBlocks({ doc });
    expect(blocks.map((b) => b.id)).toEqual(['a', 'q1', 'q2', 'q3']);
    expect(blocks[0].group).toBeUndefined();
    expect(blocks[1].group).toBe(blocks[2].group);
    expect(blocks[1].group).not.toBe(blocks[3].group);
    expect(blocks[1].kind).toBe('blockquote');
  });

  it('counts a hard break as one character so offsets line up with positions', () => {
    const doc = s.node('doc', null, s.node('paragraph', null, [s.text('ab'), s.node('hard_break'), s.text('John 3:16')]));
    const [b] = docToBlocks({ doc });
    expect(b.text).toBe('ab\nJohn 3:16');
    const result = detectNotes([b], { module: 'ESV', modules: ['ESV'] });
    const it = result.items[0];
    expect(it.from).toBe(3);
    expect(doc.textBetween(b.pos + 1 + it.from, b.pos + 1 + it.to)).toBe('John 3:16');
  });
});

describe('block ids', () => {
  it('assigns missing ids and re-assigns duplicates, keeping the first', () => {
    const doc = s.node('doc', null, [para('x', 'dup'), para('y', 'dup'), para('z')]);
    const tr = EditorState.create({ doc }).tr;
    expect(assignBlockIds(doc, tr, (() => { let n = 0; return () => `n${++n}`; })())).toBe(true);
    expect(docToBlocks({ doc: tr.doc }).map((b) => b.id)).toEqual(['dup', 'n1', 'n2']);
  });

  it('withBlockIds leaves a fully identified doc untouched', () => {
    const json = s.node('doc', null, [para('x', 'k')]).toJSON();
    expect(withBlockIds(json)).toBe(json);
    expect(docToBlocks({ doc: s.nodeFromJSON(withBlockIds(emptyDocJSON())) })[0].id).toBeTruthy();
  });
});

describe('inserting pinned items', () => {
  it('appends a pinned paragraph, reusing a trailing empty one', () => {
    const item = { kind: 'hymn' as const, hymnId: 'h1' };
    const json = appendPinnedParagraph(emptyDocJSON(), 'Amazing Grace', item);
    const blocks = docToBlocks({ doc: s.nodeFromJSON(json) });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].marks).toEqual([{ from: 0, to: 13, type: 'pin', attrs: { item } }]);
  });
});

describe('buildVerseOrder', () => {
  it('is undefined for the default (all verses, no refrain)', () => {
    expect(buildVerseOrder(3, true, [1, 2, 3], false)).toBeUndefined();
  });
  it('subsets and refrains', () => {
    expect(buildVerseOrder(3, true, [3, 1], false)).toEqual(['1', '3']);
    expect(buildVerseOrder(2, true, [1, 2], true)).toEqual(['1', 'R', '2', 'R']);
    expect(buildVerseOrder(2, false, [1, 2], true)).toBeUndefined();
  });
});
