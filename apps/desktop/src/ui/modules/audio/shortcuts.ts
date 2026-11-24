/**
 * Audio keyboard shortcuts on the desktop: the package's five keys (`registerAudioShortcuts`)
 * on one keydown listener.
 *
 * Conflict: the Bible pane's own Alt+Left (history back, `useBibleKeyboard`) listens on `window`
 * and does not look at `defaultPrevented`. The listener is therefore installed on `window` in the
 * CAPTURE phase and stops the event once an audio shortcut took it, so while audio is active
 * Alt+Left / Alt+Shift+Left mean previous verse / chapter and the rest of the time they still go
 * back. Alt+Up/Down (chapter paging) and every Ctrl shortcut are untouched.
 */
import { createKeybindingRegistry, registerAudioShortcuts } from '@bible/audio';
import type { AudioStore } from '@bible/audio';
import { markAudioRequestedPane } from './components/paneRequest';
import { desktopReaderPort } from './desktopPorts';

type KeyTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>;

/** A keydown target that listens on `window` in the capture phase and ends propagation for handled keys. */
export function capturingTarget(win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): KeyTarget {
  const wrapped = new Map<EventListenerOrEventListenerObject, EventListener>();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const fn: EventListener = e => {
        if (typeof listener === 'function') listener(e); else listener.handleEvent(e);
        if (e.defaultPrevented) e.stopImmediatePropagation();
      };
      wrapped.set(listener, fn);
      win.addEventListener(type, fn, true);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const fn = wrapped.get(listener);
      if (fn) { win.removeEventListener(type, fn, true); wrapped.delete(listener); }
    },
  } as KeyTarget;
}

/** Install the shortcuts; the returned function removes them. */
export function installAudioShortcuts(store: AudioStore, target: KeyTarget = capturingTarget()): () => void {
  const keys = createKeybindingRegistry(target as Document);
  // The Presenter is a separate window on desktop, so the arrows never stand down.
  // Alt+P records the pane it acts on, so an idle notice ("no audio for this translation") shows there.
  const shortcutTarget = {
    get enabled() { return store.enabled; },
    get status() { return store.status; },
    togglePlay() { markAudioRequestedPane(desktopReaderPort.activeTab()?.id ?? null); store.togglePlay(); },
    seekVerse: (d: 1 | -1) => store.seekVerse(d),
    seekChapter: (d: 1 | -1) => store.seekChapter(d),
  };
  const off = registerAudioShortcuts(keys, shortcutTarget, () => false);
  return () => { off(); keys.dispose(); };
}
