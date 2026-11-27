import { describe, it, expect, vi } from 'vitest';
import { capturingTarget, installAudioShortcuts } from './shortcuts';

describe('audio shortcuts', () => {
  it('a handled Alt+Left does not reach the pane history shortcut on window', () => {
    const store = { enabled: true, status: 'playing', togglePlay: vi.fn(), seekVerse: vi.fn(), seekChapter: vi.fn() };
    const off = installAudioShortcuts(store as never, capturingTarget(window));
    const history = vi.fn();
    window.addEventListener('keydown', history);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true }));
    expect(store.seekVerse).toHaveBeenCalledWith(-1);
    expect(history).not.toHaveBeenCalled();
    off();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true }));
    expect(history).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', history);
  });

  it('while idle Alt+Left is left alone', () => {
    const store = { enabled: true, status: 'idle', togglePlay: vi.fn(), seekVerse: vi.fn(), seekChapter: vi.fn() };
    const off = installAudioShortcuts(store as never, capturingTarget(window));
    const history = vi.fn();
    window.addEventListener('keydown', history);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true }));
    expect(store.seekVerse).not.toHaveBeenCalled();
    expect(history).toHaveBeenCalled();
    off(); window.removeEventListener('keydown', history);
  });
});
