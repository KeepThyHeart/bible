import { describe, it, expect, vi } from 'vitest';
import { flushActiveNote, registerActiveNoteFlush, clearActiveNoteFlush, registerShutdownFlush } from './activeNoteFlush';

describe('activeNoteFlush', () => {
  it('runs the note flush and extra shutdown flushes, surviving failures', async () => {
    const note = vi.fn().mockResolvedValue(undefined);
    const bad = vi.fn().mockRejectedValue(new Error('x'));
    const prayer = vi.fn().mockResolvedValue(undefined);
    registerActiveNoteFlush(note);
    const u1 = registerShutdownFlush(bad);
    const u2 = registerShutdownFlush(prayer);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await flushActiveNote();
    expect(note).toHaveBeenCalledOnce();
    expect(prayer).toHaveBeenCalledOnce();
    u1(); u2();
    clearActiveNoteFlush(note);
    await flushActiveNote();
    expect(prayer).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});
