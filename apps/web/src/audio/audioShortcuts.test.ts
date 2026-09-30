import { describe, it, expect, vi, afterEach } from 'vitest';
import { createKeybindingRegistry, registerAudioShortcuts, type KeyBinding, type ShortcutTarget } from './audioShortcuts';

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

describe('createKeybindingRegistry', () => {
  it('runs the matching binding on keydown, honours when(), and stops after dispose', () => {
    const reg = createKeybindingRegistry();
    const handler = vi.fn();
    let on = false;
    reg.register({ id: 'x', key: 'alt+p', label: 'x', when: () => on, handler });
    const press = (init: KeyboardEventInit) => document.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, ...init }));
    press({ key: 'p', altKey: true });
    expect(handler).not.toHaveBeenCalled();
    on = true;
    press({ key: 'P', altKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    press({ key: 'p', altKey: true, shiftKey: true });
    press({ key: 'p' });
    expect(handler).toHaveBeenCalledTimes(1);
    reg.dispose();
    press({ key: 'p', altKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
