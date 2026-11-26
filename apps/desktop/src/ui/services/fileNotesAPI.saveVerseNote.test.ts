/** `fileNotesAPI.saveVerseNote`: the IPC call, and the marker refresh after the first save. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/verseReference', () => ({
  parseVerseId: () => ({ bookNumber: 43, chapter: 3, verse: 16 }),
  getBookNameFromCache: () => 'John',
}));
import { saveVerseNote } from './fileNotesAPI';
import { onVerseNotesChanged } from './verseNoteMarkerEvents';

const invoke = vi.fn();
beforeEach(() => {
  invoke.mockReset();
  (window as unknown as { electron: unknown }).electron = { ipcRenderer: { invoke } };
});

describe('saveVerseNote', () => {
  it('sends verse id, html, baseline and book folder name; unwraps the result and refreshes markers', async () => {
    const note = { updated: 'U1' };
    invoke.mockResolvedValue({ ok: true, value: { note, relativePath: 'Verse Notes/John/3/16.bn' } });
    const changed = vi.fn();
    const off = onVerseNotesChanged(changed);
    const res = await saveVerseNote(43003016, '<p>hi</p>', 'U0');
    expect(invoke).toHaveBeenCalledWith('file-notes:save-verse-note', 43003016, '<p>hi</p>', 'U0', 'John');
    expect(res).toEqual({ note, relativePath: 'Verse Notes/John/3/16.bn' });
    expect(changed).toHaveBeenCalledTimes(1);
    off();
  });

  it('rejects with the conflict code on a stale baseline and does not refresh markers', async () => {
    invoke.mockResolvedValue({ ok: false, error: { code: 'conflict', message: 'x' } });
    const changed = vi.fn();
    const off = onVerseNotesChanged(changed);
    await expect(saveVerseNote(43003016, '<p>hi</p>', 'old')).rejects.toMatchObject({ code: 'conflict' });
    expect(changed).not.toHaveBeenCalled();
    off();
  });
});
