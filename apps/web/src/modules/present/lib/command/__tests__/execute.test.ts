import { describe, expect, it, vi } from 'vitest';
import type { PresentIntent, PresentState } from '../../protocol';
import type { HymnSummary } from '../../hymns';
import { buildVerseOrder, executeCommand, pickHymn } from '../execute';
import type { Command } from '../command';

function stateWith(live: PresentState['live'], extra: Partial<PresentState['display']> = {}): PresentState {
  return {
    version: 1,
    live,
    position: { index: 1, highlights: [] },
    display: { fontStep: 5, blanked: false, theme: 'light', ...extra },
    session: { id: 's', joinCode: 'c', joinsLocked: false, viewerCount: 0 },
  };
}
const john3 = stateWith({ kind: 'passage', module: 'kjv', book: 43, chapter: 3 });

function run(cmd: Command, state: PresentState | null, deps: Record<string, unknown> = {}) {
  const sent: PresentIntent[] = [];
  const promise = executeCommand(cmd, { sink: i => sent.push(i), state, defaultModule: 'kjv', ...deps });
  return promise.then(result => ({ result, sent }));
}

const hymn = (over: Partial<HymnSummary> = {}): HymnSummary => ({
  id: 'amazing-grace', title: 'Amazing Grace', firstLine: 'Amazing grace! How sweet the sound',
  hymnals: [{ hymnal: 'Trinity Hymnal', number: '460' }], verseCount: 5, hasRefrain: false, ...over,
});

describe('executeCommand: passages', () => {
  it('shows a whole chapter at verse 1', async () => {
    const { result, sent } = await run({ type: 'passage', book: 45, chapter: 8 }, null);
    expect(result).toEqual({ ok: true });
    expect(sent).toEqual([{ type: 'show', item: { kind: 'passage', module: 'kjv', book: 45, chapter: 8 }, index: 1 }]);
  });

  it('shows a different chapter anchored on the verse', async () => {
    const { sent } = await run({ type: 'passage', book: 45, chapter: 8, verseStart: 28 }, john3);
    expect(sent).toEqual([{ type: 'show', item: { kind: 'passage', module: 'kjv', book: 45, chapter: 8 }, index: 28 }]);
  });

  it('uses goTo for a verse in the chapter already live', async () => {
    const { sent } = await run({ type: 'passage', book: 43, chapter: 3, verseStart: 16 }, john3);
    expect(sent).toEqual([{ type: 'goTo', index: 16 }]);
  });

  it('re-shows when the translation differs', async () => {
    const { sent } = await run({ type: 'passage', book: 43, chapter: 3, verseStart: 16, module: 'esv' }, john3);
    expect(sent[0]).toMatchObject({ type: 'show', item: { module: 'esv' }, index: 16 });
  });

  it('shows a narrowed range anchored at its first verse', async () => {
    const { sent } = await run({ type: 'passage', book: 43, chapter: 3, verseStart: 16, verseEnd: 18 }, john3);
    expect(sent).toEqual([{
      type: 'show', item: { kind: 'passage', module: 'kjv', book: 43, chapter: 3, verseStart: 16, verseEnd: 18 }, index: 16,
    }]);
  });

  it('re-shows the whole chapter when the verse falls outside a narrowed live range', async () => {
    const narrowed = stateWith({ kind: 'passage', module: 'kjv', book: 43, chapter: 3, verseStart: 1, verseEnd: 5 });
    const { sent } = await run({ type: 'passage', book: 43, chapter: 3, verseStart: 16 }, narrowed);
    expect(sent[0]).toMatchObject({ type: 'show', index: 16 });
  });

  it('falls back to the live passage translation, then fails without any', async () => {
    const esv = stateWith({ kind: 'passage', module: 'esv', book: 1, chapter: 1 });
    const a = await executeCommand({ type: 'passage', book: 43, chapter: 1 }, { sink: () => {}, state: esv });
    expect(a).toEqual({ ok: true });
    const b = await executeCommand({ type: 'passage', book: 43, chapter: 1 }, { sink: () => {}, state: null });
    expect(b).toEqual({ ok: false, reason: 'noTranslation' });
  });
});

describe('executeCommand: bare verses', () => {
  it('goTo within the live chapter', async () => {
    const { sent } = await run({ type: 'verse', verseStart: 18 }, john3);
    expect(sent).toEqual([{ type: 'goTo', index: 18 }]);
  });

  it('a verse range narrows the live chapter', async () => {
    const { sent } = await run({ type: 'verse', verseStart: 18, verseEnd: 20 }, john3);
    expect(sent[0]).toMatchObject({ type: 'show', item: { book: 43, chapter: 3, verseStart: 18, verseEnd: 20 } });
  });

  it('needs a passage on screen', async () => {
    expect((await run({ type: 'verse', verseStart: 18 }, null)).result).toEqual({ ok: false, reason: 'noPassage' });
    const hymnLive = stateWith({ kind: 'hymn', hymnId: 'x' });
    expect((await run({ type: 'verse', verseStart: 1 }, hymnLive)).result).toEqual({ ok: false, reason: 'noPassage' });
  });
});

describe('executeCommand: simple commands', () => {
  it('blank toggles from the current state', async () => {
    expect((await run({ type: 'blank' }, john3)).sent).toEqual([{ type: 'blank' }]);
    expect((await run({ type: 'blank' }, stateWith(john3.live, { blanked: true }))).sent).toEqual([{ type: 'unblank' }]);
    expect((await run({ type: 'blank' }, null)).sent).toEqual([{ type: 'blank' }]);
  });

  it('clear sends clearHighlights', async () => {
    expect((await run({ type: 'clear' }, john3)).sent).toEqual([{ type: 'clearHighlights' }]);
  });

  it('help calls the handler and sends nothing', async () => {
    const onHelp = vi.fn();
    const { sent, result } = await run({ type: 'help' }, john3, { onHelp });
    expect(onHelp).toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('search goes to onSearch, and is refused when there is none', async () => {
    const onSearch = vi.fn();
    expect((await run({ type: 'search', query: 'grace' }, null, { onSearch })).result.ok).toBe(true);
    expect(onSearch).toHaveBeenCalledWith('grace');
    expect((await run({ type: 'search', query: 'grace' }, null)).result).toEqual({ ok: false, reason: 'searchDisabled' });
  });

  it('none is an empty failure', async () => {
    expect((await run({ type: 'none' }, null)).result).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('executeCommand: hymns', () => {
  it('looks a hymn up by title and shows it', async () => {
    const searchHymns = vi.fn().mockResolvedValue([hymn()]);
    const rememberHymns = vi.fn();
    const { result, sent } = await run({ type: 'hymn', title: 'amazing grace', verses: [] }, null, { searchHymns, rememberHymns });
    expect(searchHymns).toHaveBeenCalledWith('amazing grace');
    expect(rememberHymns).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(sent).toEqual([{ type: 'show', item: { kind: 'hymn', hymnId: 'amazing-grace' }, index: 0 }]);
  });

  it('by hymnal number, requiring an exact number match', async () => {
    const searchHymns = vi.fn().mockResolvedValue([hymn(), hymn({ id: 'other', hymnals: [{ hymnal: 'x', number: '46' }] })]);
    const ok = await run({ type: 'hymn', number: '460', verses: [] }, null, { searchHymns });
    expect(ok.sent[0]).toMatchObject({ item: { hymnId: 'amazing-grace' } });
    const miss = await run({ type: 'hymn', number: '12', verses: [] }, null, { searchHymns });
    expect(miss.result).toEqual({ ok: false, reason: 'hymnNotFound' });
  });

  it('applies the verse list', async () => {
    const searchHymns = vi.fn().mockResolvedValue([hymn()]);
    const { sent } = await run({ type: 'hymn', title: 'amazing grace', verses: ['1', '2', '5'] }, null, { searchHymns });
    expect(sent[0]).toMatchObject({ item: { verseOrder: ['1', '2', '5'] } });
  });

  it('reports not found, unavailable and a failing library', async () => {
    const empty = await run({ type: 'hymn', title: 'zzz', verses: [] }, null, { searchHymns: async () => [] });
    expect(empty.result).toEqual({ ok: false, reason: 'hymnNotFound' });
    const none = await run({ type: 'hymn', title: 'zzz', verses: [] }, null);
    expect(none.result).toEqual({ ok: false, reason: 'hymnUnavailable' });
    const boom = await run({ type: 'hymn', title: 'zzz', verses: [] }, null, { searchHymns: async () => { throw new Error('x'); } });
    expect(boom.result).toEqual({ ok: false, reason: 'hymnUnavailable' });
    expect(boom.sent).toEqual([]);
  });
});

describe('buildVerseOrder', () => {
  const plain = { verseCount: 5, hasRefrain: false };
  const withRefrain = { verseCount: 4, hasRefrain: true };
  it('is undefined for no list', () => expect(buildVerseOrder([], plain)).toBeUndefined());
  it('passes verses through when there is no refrain', () => expect(buildVerseOrder(['1', '3'], plain)).toEqual(['1', '3']));
  it('puts the refrain after each verse when the hymn has one', () => {
    expect(buildVerseOrder(['1', '2'], withRefrain)).toEqual(['1', 'R', '2', 'R']);
  });
  it('takes an explicit R list exactly as written', () => {
    expect(buildVerseOrder(['1', '2', 'R'], withRefrain)).toEqual(['1', '2', 'R']);
  });
  it('drops verses the hymn lacks, and an R it lacks', () => {
    expect(buildVerseOrder(['1', '9'], plain)).toEqual(['1']);
    expect(buildVerseOrder(['9'], plain)).toBeUndefined();
    expect(buildVerseOrder(['1', 'R'], plain)).toEqual(['1']);
  });
});

describe('pickHymn', () => {
  const a = hymn({ id: 'a', title: 'Grace Greater Than Our Sin' });
  const b = hymn({ id: 'b', title: 'Amazing Grace' });
  it('prefers an exact title, then a prefix, then the first hit', () => {
    expect(pickHymn([a, b], { title: 'amazing grace' })?.id).toBe('b');
    expect(pickHymn([a, b], { title: 'grace great' })?.id).toBe('a');
    expect(pickHymn([a, b], { title: 'sweet sound' })?.id).toBe('a');
    expect(pickHymn([], { title: 'x' })).toBeNull();
  });
});
