import { describe, expect, it } from 'vitest';
import { computeDecorations, findPlayItemId, isSameItem } from '../decorations';
import type { DetectResult, NotesItem } from '../types';

const item = (over: Partial<NotesItem>): NotesItem => ({
  id: 'i1', blockPos: 10, from: 2, to: 11, kind: 'passage',
  item: { kind: 'passage', module: 'ESV', book: 43, chapter: 3, verseStart: 16 },
  status: 'ok', source: 'detected', label: 'John 3:16', ...over,
});
const result = (items: NotesItem[], highlights: DetectResult['highlights'] = []): DetectResult =>
  ({ items, highlights, sections: [], needsChapters: [] });
const opts = { docSize: 200, playItemId: null, translate: (k: string, p?: Record<string, string | number>) => `${k}|${JSON.stringify(p ?? {})}` };

describe('computeDecorations', () => {
  it('maps block offsets to document positions and adds a play widget', () => {
    const out = computeDecorations(result([item({})]), opts);
    expect(out[0]).toMatchObject({ type: 'inline', from: 13, to: 22 });
    expect(out[0].type === 'inline' && out[0].attrs.class).toBe('pn-item pn-item--passage');
    expect(out[1]).toEqual({ type: 'widget', pos: 22, itemId: 'i1' });
  });

  it('marks amber items with the translated reason and no widget when nothing is showable', () => {
    const it = item({ kind: 'hymn', item: null, status: 'choose', reason: { key: 'present.notes.reason.hymnNotFound', params: { title: 'X' } } });
    const out = computeDecorations(result([it]), opts);
    expect(out).toHaveLength(1);
    const d = out[0];
    expect(d.type === 'inline' && d.attrs.class).toContain('pn-item--choose');
    expect(d.type === 'inline' && d.attrs.title).toBe('present.notes.reason.hymnNotFound|{"title":"X"}');
  });

  it('draws the play item green and pinned items as pinned', () => {
    const out = computeDecorations(result([item({ source: 'pinned' })]), { ...opts, playItemId: 'i1' });
    expect(out[0].type === 'inline' && out[0].attrs.class).toContain('pn-item--live');
    expect(out[0].type === 'inline' && out[0].attrs.class).toContain('pn-item--pinned');
  });

  it('spans several blocks for a multi-paragraph quote and skips out-of-range items', () => {
    const q = item({ id: 'q', kind: 'quote', item: { kind: 'quote', text: 'x' }, endBlockPos: 40, endTo: 5 });
    const out = computeDecorations(result([q, item({ id: 'gone', blockPos: 500 })]), opts);
    expect(out.filter((d) => d.type === 'inline')).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: 13, to: 46 });
  });

  it('draws highlights as yellow, amber when they need a choice', () => {
    const hl = { id: 'h', blockPos: 20, from: 0, to: 4, text: 'love', itemId: 'i1', range: null, status: 'choose' as const, source: 'detected' as const, reason: { key: 'k' } };
    const out = computeDecorations(result([], [hl, { ...hl, id: 'h2', status: 'ok' }]), opts);
    expect(out[0].type === 'inline' && out[0].attrs.class).toBe('pn-hl pn-hl--choose');
    expect(out[1].type === 'inline' && out[1].attrs.class).toBe('pn-hl');
    expect(out[1].type === 'inline' && out[1].span).toEqual({ id: 'h2', kind: 'highlight', from: 21, to: 25 });
  });
});

describe('play item matching', () => {
  const a = item({ id: 'a' });
  const b = item({ id: 'b' });
  const live = { kind: 'passage' as const, module: 'ESV', book: 43, chapter: 3, verseStart: 16 };
  it('compares items by what they show', () => {
    expect(isSameItem(a.item, live)).toBe(true);
    expect(isSameItem(a.item, { ...live, verseStart: 17 })).toBe(false);
    expect(isSameItem({ kind: 'hymn', hymnId: 'x' }, { kind: 'hymn', hymnId: 'x', verseOrder: ['1'] })).toBe(true);
    expect(isSameItem(null, live)).toBe(false);
  });
  it('prefers the last shown match, else the first, else null', () => {
    expect(findPlayItemId([a, b], live, 'b')).toBe('b');
    expect(findPlayItemId([a, b], live, null)).toBe('a');
    expect(findPlayItemId([a, b], { kind: 'hymn', hymnId: 'z' }, 'a')).toBeNull();
    expect(findPlayItemId([a, b], null, 'a')).toBeNull();
  });
});
