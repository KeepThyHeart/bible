import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'path';

const sent: Array<{ id: number; channel: string; payload: unknown }> = [];
function win(id: number, destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    webContents: { id, send: (channel: string, payload: unknown) => sent.push({ id, channel, payload }) },
  };
}
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [win(1), win(2), win(3), win(4, true)] },
  ipcMain: { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(ch, fn) },
  dialog: {},
}));
vi.mock('electron-log', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../services/MainI18n', () => ({ t: (k: string) => k }));
vi.mock('../noteDocx', () => ({ buildNoteDocx: vi.fn() }));
vi.mock('../noteDirectionHandlers', () => ({ moveNoteDirectionKeys: vi.fn(), clearNoteDirectionKeys: vi.fn() }));
vi.mock('../blessedPaths', () => ({ blessPath: vi.fn(), isPathBlessed: () => false, isPathWithin: () => true }));
vi.mock('../../services/NetworkGateway', () => ({ NetworkBlockedError: class extends Error {} }));

const saveNote = vi.fn();
const saveNoteAbsolute = vi.fn();
vi.mock('../../services/BibleNotesFileService', () => ({
  BibleNotesFileService: class {
    getNotesDir() { return '/notes'; }
    saveNote = saveNote;
    saveNoteAbsolute = saveNoteAbsolute;
  },
  NoteConflictError: class NoteConflictError extends Error {},
  NoteMissingError: class NoteMissingError extends Error {},
}));

import { registerFileNotesHandlers, initializeFileNotesService } from '../fileNotesHandlers';

const note = { title: 't' };
const event = (senderId: number) => ({ sender: { id: senderId } });

beforeEach(() => {
  sent.length = 0;
  saveNote.mockReset();
  saveNoteAbsolute.mockReset();
  handlers.clear();
  initializeFileNotesService('/notes');
  registerFileNotesHandlers();
});

describe('file-notes save broadcast', () => {
  it('relative save from window 2 reaches 1 and 3 only, with the resolved path', async () => {
    saveNote.mockReturnValue('2026-01-01T00:00:00.000Z');
    const res = await handlers.get('file-notes:save-note')!(event(2), 'a/b.bn', note, 'x');
    expect(res).toEqual({ ok: true, value: '2026-01-01T00:00:00.000Z' });
    expect(sent.map(s => s.id)).toEqual([1, 3]);
    expect(sent[0].channel).toBe('file-notes:note-saved');
    expect(sent[0].payload).toEqual({
      absolutePath: resolve('/notes', 'a/b.bn'),
      updated: '2026-01-01T00:00:00.000Z',
      senderId: 2,
    });
  });

  it('absolute save broadcasts too and skips the sender', async () => {
    saveNoteAbsolute.mockReturnValue('u1');
    await handlers.get('file-notes:save-note-absolute')!(event(1), '/notes/c.bn', note, undefined);
    expect(sent.map(s => s.id)).toEqual([2, 3]);
    expect((sent[0].payload as { absolutePath: string }).absolutePath).toBe(resolve('/notes/c.bn'));
  });

  it('a failed (conflict) save sends nothing', async () => {
    saveNote.mockImplementation(() => { throw new Error('boom'); });
    const res = (await handlers.get('file-notes:save-note')!(event(2), 'a.bn', note, 'x')) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
