/** `fileNotesAPI`: readVerseNotes, exportNoteDocx, and the origin announced after saves. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/verseReference', () => ({
  parseVerseId: () => ({ bookNumber: 43, chapter: 3, verse: 16 }),
  getBookNameFromCache: () => 'John',
}));
import { readVerseNotes, exportNoteDocx, saveNote, saveNoteAbsolute, saveVerseNote } from './fileNotesAPI';
import { onLocalNoteSaved } from './noteSavedLocal';

const invoke = vi.fn();
beforeEach(() => {
  invoke.mockReset();
  (window as unknown as { electron: unknown }).electron = { ipcRenderer: { invoke } };
});
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('fileNotesAPI bulk/export/origin', () => {
  it('readVerseNotes sends the queries and unwraps', async () => {
    invoke.mockResolvedValue({ ok: true, value: [{ verse: 1 }] });
    const q = [{ bookName: 'Romans', chapter: 8 }];
    expect(await readVerseNotes(q)).toEqual([{ verse: 1 }]);
    expect(invoke).toHaveBeenCalledWith('file-notes:read-verse-notes', q);
  });

  it('readVerseNotes rejects with the error code', async () => {
    invoke.mockResolvedValue({ ok: false, error: { code: 'invalid_input', message: 'x' } });
    await expect(readVerseNotes([])).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('exportNoteDocx wraps export-docx and returns the path', async () => {
    invoke.mockResolvedValue({ ok: true, value: '/tmp/a.docx' });
    expect(await exportNoteDocx('n', '<p>x</p>', 'T')).toBe('/tmp/a.docx');
    expect(invoke).toHaveBeenCalledWith('file-notes:export-docx', 'n', '<p>x</p>', 'T');
    invoke.mockResolvedValue({ ok: true, value: null });
    expect(await exportNoteDocx('n', '', 'T')).toBeNull();
  });

  it('save calls announce path, updated and origin on the local bus', async () => {
    const seen: unknown[] = [];
    const off = onLocalNoteSaved((e) => seen.push(e));
    const note = { updated: 'U0', content: '<p>a</p>' } as never;
    invoke.mockResolvedValueOnce({ ok: true, value: 'U1' });
    await saveNote('a.bn', note, 'U0', 'chapter:1');
    invoke.mockResolvedValueOnce({ ok: true, value: 'U2' });
    await saveNoteAbsolute('/abs/a.bn', note, 'U1', 'o2');
    invoke.mockResolvedValueOnce({ ok: true, value: { note: { updated: 'U3' }, relativePath: 'Verse Notes/John/3/16.bn' } });
    await saveVerseNote(43003016, '<p>a</p>', undefined, undefined, 'o3');
    expect(seen).toEqual([]); // not synchronous
    await tick();
    expect(seen).toEqual([
      { path: 'a.bn', updated: 'U1', origin: 'chapter:1' },
      { path: '/abs/a.bn', updated: 'U2', origin: 'o2' },
      { path: 'Verse Notes/John/3/16.bn', updated: 'U3', origin: 'o3' },
    ]);
    off();
  });

  it('a failed save announces nothing', async () => {
    const cb = vi.fn();
    const off = onLocalNoteSaved(cb);
    invoke.mockResolvedValue({ ok: false, error: { code: 'conflict', message: 'x' } });
    await expect(saveNote('a.bn', { content: '' } as never, 'old')).rejects.toBeTruthy();
    await tick();
    expect(cb).not.toHaveBeenCalled();
    off();
  });
});
