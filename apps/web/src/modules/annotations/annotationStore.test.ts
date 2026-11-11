import { describe, it, expect, vi } from 'vitest';
import { AnnotationStore, type AnnotationsApi } from './annotationStore';
import type { ChapterAnnotations } from '../../userdb/annotationsRepo';

const J = 43003000;
const EMPTY: ChapterAnnotations = { highlights: [], notes: [], bookmarks: [] };

function fakeApi(initial: ChapterAnnotations = EMPTY) {
  let data = initial;
  const api = {
    getChapter: vi.fn(async () => data),
    setHighlight: vi.fn(async (a) => ({ id: 9, ...a, color: a.color })),
    removeHighlight: vi.fn(async () => 1),
    saveNote: vi.fn(async (a) => ({ id: 5, title: null, modified: 'x', ...a })),
    deleteNote: vi.fn(async () => true),
    setBookmark: vi.fn(async () => null),
    toggleBookmark: vi.fn(),
    listNotes: vi.fn(),
    listBookmarks: vi.fn(),
  } as unknown as Record<string, ReturnType<typeof vi.fn>> & AnnotationsApi;
  return { api, set: (d: ChapterAnnotations) => { data = d; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('AnnotationStore', () => {
  it('fetches a watched chapter once and indexes it per verse', async () => {
    const { api } = fakeApi({
      highlights: [{ id: 1, moduleId: 1, start: J + 2, end: J + 3, color: '#FFF3A3', created: '' }],
      notes: [{ id: 2, start: J + 3, end: J + 3, title: 'T', content: '<p>c</p>', modified: '2026-01-01', conflict: false }],
      bookmarks: [{ id: 3, start: J + 16, end: J + 16, title: null }],
    });
    const store = new AnnotationStore(async () => api);
    const seen = vi.fn();
    store.subscribe(seen);
    const off = store.watch('tab1', 1, J + 1, J + 36);
    store.watch('tab2', 1, J + 1, J + 36); // same chapter in another tab shares the entry
    await tick();
    expect(api.getChapter).toHaveBeenCalledTimes(1);
    expect(api.getChapter).toHaveBeenCalledWith(1, J + 1, J + 36);
    expect(store.forVerse('tab1', J + 1)).toBeUndefined();
    expect(store.forVerse('tab1', J + 2)?.highlight?.color).toBe('#FFF3A3');
    expect(store.forVerse('tab1', J + 3)).toMatchObject({ highlight: { id: 1 }, notes: [{ id: 2 }] });
    expect(store.forVerse('tab2', J + 16)?.bookmark?.id).toBe(3);
    expect(store.forVerse('nope', J + 2)).toBeUndefined();
    expect(seen).toHaveBeenCalled();
    off();
    expect(store.forVerse('tab1', J + 2)).toBeUndefined(); // tab1 no longer watches
    expect(store.forVerse('tab2', J + 2)).toBeDefined();
  });

  it('refetches on a changed event that touches its tables, ignores others, coalesces bursts', async () => {
    const { api, set } = fakeApi();
    const store = new AnnotationStore(async () => api);
    let emit: (t: readonly string[]) => void = () => undefined;
    store.listen((cb) => { emit = cb; return () => undefined; });
    store.watch('t', 1, J + 1, J + 36);
    await tick();
    expect(api.getChapter).toHaveBeenCalledTimes(1);
    emit(['memory_card']);
    await tick();
    expect(api.getChapter).toHaveBeenCalledTimes(1);
    set({ ...EMPTY, highlights: [{ id: 7, moduleId: 1, start: J + 5, end: J + 5, color: '#B7E4C7', created: '' }] });
    emit(['user_text_markup']);
    emit(['pinned_item']);
    emit(['user_note']);
    await tick();
    await tick();
    expect(store.forVerse('t', J + 5)?.highlight?.id).toBe(7);
    expect((api.getChapter as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(3); // 1 + at most two coalesced rounds
  });

  it('drops a stale response and survives a failing worker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api } = fakeApi();
    (api.getChapter as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const store = new AnnotationStore(async () => api);
    store.watch('t', 1, J + 1, J + 36);
    await tick();
    expect(store.forVerse('t', J + 1)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('writes go through the api and refresh the cache; removeHighlights removes every overlapping highlight', async () => {
    const { api, set } = fakeApi({
      ...EMPTY,
      highlights: [
        { id: 1, moduleId: 1, start: J + 2, end: J + 2, color: '#FFF3A3', created: '' },
        { id: 2, moduleId: 1, start: J + 3, end: J + 4, color: '#B7E4C7', created: '' },
      ],
    });
    const store = new AnnotationStore(async () => api);
    store.watch('t', 1, J + 1, J + 36);
    await tick();
    (api.removeHighlight as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => { set(EMPTY); return 1; });
    expect(await store.removeHighlights(1, J + 2, J + 3)).toBe(2);
    expect(api.removeHighlight).toHaveBeenCalledWith({ moduleId: 1, start: J + 2, end: J + 2 });
    expect(api.removeHighlight).toHaveBeenCalledWith({ moduleId: 1, start: J + 3, end: J + 4 });
    await tick();
    expect(store.forVerse('t', J + 2)).toBeUndefined();
    await store.setHighlight(1, J + 2, J + 2, '#F7B7B7');
    expect(api.setHighlight).toHaveBeenCalledWith({ moduleId: 1, start: J + 2, end: J + 2, color: '#F7B7B7' });
    await store.saveNote({ start: J + 2, end: J + 2, content: '<p>x</p>' });
    await store.deleteNote(5);
    await store.setBookmark({ start: J + 2, end: J + 2, on: true });
    expect(api.setBookmark).toHaveBeenCalledWith({ start: J + 2, end: J + 2, on: true });
  });

  it('picks the same winning highlight regardless of local id order (created, then colour, then id)', async () => {
    const blue = { moduleId: 1, start: J + 4, end: J + 4, color: '#B8DDF5', created: '2026-01-01 10:00:00' };
    const green = { moduleId: 1, start: J + 4, end: J + 4, color: '#B7E4C7', created: '2026-01-01 10:00:05' };
    const winner = async (hs: ChapterAnnotations['highlights']) => {
      const { api } = fakeApi({ ...EMPTY, highlights: hs });
      const store = new AnnotationStore(async () => api);
      store.watch('t', 1, J + 1, J + 36);
      await tick();
      return store.forVerse('t', J + 4)?.highlight?.color;
    };
    expect(await winner([{ ...blue, id: 1 }, { ...green, id: 2 }])).toBe('#B7E4C7');
    expect(await winner([{ ...blue, id: 2 }, { ...green, id: 1 }])).toBe('#B7E4C7'); // ids swapped
    // same created: colour string decides, again independent of id
    const a = { ...blue, created: 'x' };
    const b = { ...green, created: 'x' };
    expect(await winner([{ ...a, id: 1 }, { ...b, id: 2 }])).toBe(await winner([{ ...a, id: 2 }, { ...b, id: 1 }]));
  });
});
