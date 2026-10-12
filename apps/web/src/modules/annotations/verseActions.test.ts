import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ fetch: vi.fn(), setBookmark: vi.fn() }));
vi.mock('./instance', () => ({ annotationStore: store }));
vi.mock('../../stores/moduleStore', () => ({
  moduleStore: { availableModules: [{ module_id: 3, abbreviation: 'KJV', name: '', type: 'bible', language_code: 'en' }] },
}));
vi.mock('../../utils/verseId', () => ({ formatVerseRange: (a: number, b?: number) => (b && b !== a ? `r${a}-${b}` : `r${a}`) }));
vi.mock('../../i18n', () => ({ default: { t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) } }));

import { bookmarkHandler, highlightHandler, noteHandler } from './verseActions';
import { annotationUi } from './annotationUi';

const ctx = (ids: number[], module = 'KJV') => ({ verseId: ids[0], verseIds: ids, module, surface: 'reader' });
const data = (over = {}) => ({ highlights: [], notes: [], bookmarks: [], ...over });

beforeEach(() => {
  annotationUi.reset();
  store.fetch.mockReset();
  store.setBookmark.mockReset();
});

describe('verse action handlers', () => {
  it('highlight opens the popover over the selection with the colour under the first verse', async () => {
    store.fetch.mockResolvedValue(data({ highlights: [{ id: 1, moduleId: 3, start: 10, end: 10, color: '#B7E4C7' }] }));
    await highlightHandler.run(ctx([12, 10, 11]));
    expect(store.fetch).toHaveBeenCalledWith(3, 10, 12);
    expect(annotationUi.popover).toEqual({ moduleId: 3, start: 10, end: 12, color: '#B7E4C7', hasHighlight: true });
  });

  it('highlight without existing markup offers no Remove', async () => {
    store.fetch.mockResolvedValue(data());
    await highlightHandler.run(ctx([10]));
    expect(annotationUi.popover).toMatchObject({ color: null, hasHighlight: false });
  });

  it('note opens the existing note covering the selection, else a blank one', async () => {
    const n = { id: 2, start: 10, end: 11, title: 'a', content: 'c', modified: 'm' };
    store.fetch.mockResolvedValueOnce(data({ notes: [n] }));
    await noteHandler.run(ctx([11]));
    expect(annotationUi.note).toEqual({ start: 10, end: 11, reference: 'r10-11', note: n });
    store.fetch.mockResolvedValueOnce(data());
    await noteHandler.run(ctx([20]));
    expect(annotationUi.note).toEqual({ start: 20, end: 20, reference: 'r20', note: null });
  });

  it('bookmark sets (idempotent) the opposite of what exists and says so', async () => {
    store.fetch.mockResolvedValueOnce(data());
    await bookmarkHandler.run(ctx([10]));
    expect(store.setBookmark).toHaveBeenLastCalledWith({ start: 10, end: 10, on: true, moduleId: 3, title: 'r10' });
    expect(annotationUi.toast?.text).toContain('bookmarkAdded');
    store.fetch.mockResolvedValueOnce(data({ bookmarks: [{ id: 1, start: 10, end: 10, title: null }] }));
    await bookmarkHandler.run(ctx([10]));
    expect(store.setBookmark).toHaveBeenLastCalledWith({ start: 10, end: 10, on: false, moduleId: 3, title: 'r10' });
    expect(annotationUi.toast?.text).toContain('bookmarkRemoved');
  });

  it('does nothing for a module the catalog does not know; a failing worker shows an error toast', async () => {
    await highlightHandler.run(ctx([10], 'XYZ'));
    expect(annotationUi.popover).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    store.fetch.mockRejectedValue(new Error('down'));
    await noteHandler.run(ctx([10]));
    expect(annotationUi.toast?.text).toBe('annotations.error');
    warn.mockRestore();
  });
});
