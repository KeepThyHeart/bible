import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerAudioShortcuts, type ShortcutTarget } from './audioShortcuts';
import type { KeyBinding } from '../plugins/registries/KeybindingRegistry';

function setup(state: Partial<ShortcutTarget> = {}) {
  const bindings = new Map<string, KeyBinding>();
  const audio: ShortcutTarget = {
    enabled: true, status: 'playing', togglePlay: vi.fn(), seekVerse: vi.fn(), seekChapter: vi.fn(), ...state,
  };
  const off = registerAudioShortcuts({ register: b => { bindings.set(b.id, b); return () => bindings.delete(b.id); } }, audio);
  return { bindings, audio, off };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('audio shortcuts', () => {
  it('registers the five documented keys', () => {
    const { bindings } = setup();
    expect([...bindings.values()].map(b => b.key)).toEqual(['alt+p', 'alt+arrowleft', 'alt+arrowright', 'alt+shift+arrowleft', 'alt+shift+arrowright']);
  });

  it('their handlers call the store', () => {
    const { bindings, audio } = setup();
    bindings.get('audio.toggle')!.handler();
    bindings.get('audio.prevVerse')!.handler();
    bindings.get('audio.nextVerse')!.handler();
    bindings.get('audio.prevChapter')!.handler();
    bindings.get('audio.nextChapter')!.handler();
    expect(audio.togglePlay).toHaveBeenCalledTimes(1);
    expect((audio.seekVerse as ReturnType<typeof vi.fn>).mock.calls).toEqual([[-1], [1]]);
    expect((audio.seekChapter as ReturnType<typeof vi.fn>).mock.calls).toEqual([[-1], [1]]);
  });

  it('the arrows act only while audio is active, so Alt+Left stays "browser back" otherwise', () => {
    const { bindings } = setup({ status: 'idle' });
    expect(bindings.get('audio.prevVerse')!.when!()).toBe(false);
    expect(bindings.get('audio.toggle')!.when!()).toBe(true);
  });

  it('nothing acts when the feature is off', () => {
    const { bindings } = setup({ enabled: false });
    for (const b of bindings.values()) expect(b.when!()).toBe(false);
  });

  it('the arrows leave text fields alone', () => {
    const { bindings } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(bindings.get('audio.nextVerse')!.when!()).toBe(false);
    input.blur();
    const range = document.createElement('input');
    range.type = 'range';
    document.body.appendChild(range);
    range.focus();
    expect(bindings.get('audio.nextVerse')!.when!()).toBe(true);
  });

  it('unregisters', () => {
    const { bindings, off } = setup();
    off();
    expect(bindings.size).toBe(0);
  });
});
