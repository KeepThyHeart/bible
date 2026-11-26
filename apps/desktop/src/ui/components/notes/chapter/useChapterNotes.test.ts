import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

let remote: ((e: { absolutePath: string; updated: string; senderId: number }) => void) | null = null;
const readVerseNotes = vi.fn();
const readVerseNote = vi.fn();
vi.mock('../../../services/fileNotesAPI', () => ({
  readVerseNotes: (...a: unknown[]) => readVerseNotes(...a),
  readVerseNote: (...a: unknown[]) => readVerseNote(...a),
  getNotesDir: async () => '/notes',
  onNoteSaved: (cb: typeof remote) => { remote = cb; return () => { remote = null; }; },
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: async () => [{ book_number: 45, book_name: 'Romans' }] } }));
const getVersesCached = vi.fn();
vi.mock('../../../services/verseFetchCache', () => ({ getVersesCached: (...a: unknown[]) => getVersesCached(...a) }));
vi.mock('../../../stores/useBibleStore', () => ({
  useBibleStore: (sel: (s: unknown) => unknown) => sel({ availableBibles: [{ abbreviation: 'KJV', module_id: 7, name: 'KJV', database_path: '' }], loadAvailableBibles: vi.fn() }),
}));

import { useChapterNotes } from './useChapterNotes';
import { announceLocalNoteSaved } from '../../../services/noteSavedLocal';
import { notifyVerseNotesChanged } from '../../../services/verseNoteMarkerEvents';

const verses = [1, 2, 3].map(v => ({ verse_id: 45008000 + v, book_number: 45, chapter: 8, verse: v, text: `t${v}`, text_html: v === 2 ? '<span class="christ-words">h2</span>' : undefined }));
const note = (content: string, updated = 't1') => ({ bn: 1, type: 'verse_note', title: 'T', tags: [], passages: [], created: 'c', updated, content, metadata: {} });
const bulk = (verse: number, content: string, updated = 't1') => ({ bookName: 'Romans', chapter: 8, verse, relativePath: `Verse Notes/Romans/8/${verse}.bn`, note: note(content, updated) });
const flushMicro = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

beforeEach(() => {
  readVerseNotes.mockReset().mockResolvedValue([bulk(1, '<p>one</p>')]);
  readVerseNote.mockReset();
  getVersesCached.mockReset().mockResolvedValue(verses);
  remote = null;
});

const mount = (over: Partial<{ chapter: number; translation: string }> = {}) =>
  renderHook((p: { chapter: number; translation?: string }) => useChapterNotes({ book: 45, chapter: p.chapter, translation: p.translation, origin: 'chapter:p1' }),
    { initialProps: { chapter: 8, translation: 'KJV', ...over } });

describe('useChapterNotes', () => {
  it('loads verses with their notes in ONE bulk read', async () => {
    const h = mount();
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    expect(readVerseNotes).toHaveBeenCalledTimes(1);
    expect(readVerseNotes).toHaveBeenCalledWith([{ bookName: 'Romans', chapter: 8 }]);
    expect(getVersesCached).toHaveBeenCalledWith('KJV', 45008001, 45008999);
    const { rows, folderName, moduleId } = h.result.current;
    expect(folderName).toBe('Romans');
    expect(moduleId).toBe(7);
    expect(rows.map(r => r.verse)).toEqual([1, 2, 3]);
    expect(rows[1].verseHtml).toContain('christ-words');
    expect(rows[0].verseHtml).toBe('t1');
    expect(rows[0].record?.note.content).toBe('<p>one</p>');
    expect(rows[1].record).toBeNull();
  });

  it('reports an error when the load fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getVersesCached.mockRejectedValue(new Error('boom'));
    const h = mount();
    await waitFor(() => expect(h.result.current.status).toBe('error'));
  });

  it('a slower load of the previous chapter is dropped', async () => {
    let release!: (v: unknown) => void;
    getVersesCached.mockImplementationOnce(() => new Promise(r => { release = r; }));
    const h = mount();
    getVersesCached.mockResolvedValue([{ ...verses[0], verse_id: 45009001, chapter: 9, text: 'ch9' }]);
    h.rerender({ chapter: 9, translation: 'KJV' });
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    await act(async () => { release(verses); await Promise.resolve(); });
    expect(h.result.current.rows.map(r => r.verseHtml)).toEqual(['ch9']);
  });

  it('a save elsewhere refreshes only the matching verse', async () => {
    const h = mount();
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    readVerseNote.mockResolvedValue({ relativePath: 'Verse Notes/Romans/8/2.bn', note: note('<p>two</p>', 't5') });
    act(() => announceLocalNoteSaved({ path: 'Verse Notes/Romans/8/2.bn', updated: 't5', origin: 'other' }));
    await flushMicro(); await flushMicro();
    await waitFor(() => expect(h.result.current.rows[1].record?.note.content).toBe('<p>two</p>'));
    expect(readVerseNote).toHaveBeenCalledTimes(1);
    expect(readVerseNote).toHaveBeenCalledWith('Romans', 8, 2);
    expect(h.result.current.rows[0].record?.note.content).toBe('<p>one</p>');
  });

  it('ignores its own origin, other chapters and other books', async () => {
    const h = mount();
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    act(() => {
      announceLocalNoteSaved({ path: 'Verse Notes/Romans/8/2.bn', updated: 't5', origin: 'chapter:p1' });
      announceLocalNoteSaved({ path: 'Verse Notes/Romans/9/2.bn', updated: 't5', origin: 'x' });
      announceLocalNoteSaved({ path: 'Verse Notes/Mark/8/2.bn', updated: 't5', origin: 'x' });
    });
    await flushMicro(); await flushMicro();
    expect(readVerseNote).not.toHaveBeenCalled();
  });

  it('a remote save is matched by absolute path', async () => {
    const h = mount();
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    readVerseNote.mockResolvedValue({ relativePath: 'Verse Notes/Romans/8/3.bn', note: note('<p>three</p>', 't7') });
    act(() => remote!({ absolutePath: '/notes/Verse Notes/Romans/8/3.bn', updated: 't7', senderId: 3 }));
    await waitFor(() => expect(h.result.current.rows[2].record?.note.content).toBe('<p>three</p>'));
  });

  it('a note emptied elsewhere loses its record', async () => {
    const h = mount();
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    readVerseNote.mockResolvedValue({ relativePath: 'Verse Notes/Romans/8/1.bn', note: note('<p></p>', 't8') });
    act(() => announceLocalNoteSaved({ path: 'Verse Notes/Romans/8/1.bn', updated: 't8', origin: 'x' }));
    await waitFor(() => expect(h.result.current.rows[0].record).toBeNull());
  });

  it('a delete/rename re-reads the whole chapter', async () => {
    const h = mount();
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    readVerseNotes.mockResolvedValue([]);
    act(() => notifyVerseNotesChanged());
    await waitFor(() => expect(h.result.current.rows[0].record).toBeNull());
    expect(readVerseNotes).toHaveBeenCalledTimes(2);
  });

  it('setRecord replaces one record, and null (or an empty note) clears it', async () => {
    const h = mount();
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    act(() => h.result.current.setRecord(2, bulk(2, '<p>new</p>') as never));
    expect(h.result.current.rows[1].record?.note.content).toBe('<p>new</p>');
    act(() => h.result.current.setRecord(2, bulk(2, '<p></p>') as never));
    expect(h.result.current.rows[1].record).toBeNull();
  });
});
