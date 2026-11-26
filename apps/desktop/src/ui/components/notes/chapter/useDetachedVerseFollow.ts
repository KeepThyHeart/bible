/**
 * A popped-out notes window has no Bible pane and no storeSync wiring, so nothing tells its
 * notes panel which verse the reader picked in the main window. Commentary's pop-out listens
 * to `verse-changed` itself; this does the same for the notes panel's `currentVerseId`, which
 * Chapter mode's Follow reads.
 */
import { useEffect } from 'react';
import { useNotesStore } from '../../../stores/useNotesStore';

let wiredFor: ((verseId: number) => void) | null = null;
let registered = false;

export function useDetachedVerseFollow(isDetached: boolean, panelId: string): void {
  useEffect(() => {
    if (!isDetached) return undefined;
    const on = window.electron?.window?.onVerseChanged;
    if (!on) return undefined;
    // ipcRenderer listeners cannot be removed through the preload bridge: register once and
    // route to whichever pane is mounted.
    const handler = (verseId: number) => {
      void useNotesStore.getState().syncToVerse(panelId, verseId); // allow-getstate: IPC callback - imperative store write outside render
    };
    wiredFor = handler;
    if (!registered) {
      registered = true;
      on((verseId: number) => wiredFor?.(verseId));
    }
    return () => { if (wiredFor === handler) wiredFor = null; };
  }, [isDetached, panelId]);
}

/** Test hook. */
export function resetDetachedVerseFollowForTests(): void {
  wiredFor = null;
  registered = false;
}
