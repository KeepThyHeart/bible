/**
 * The desktop app's one audio store (the shared `AudioStore` from `@bible/audio`) and the
 * React hooks components read it with. A "tab" here is a Bible pane (its panel id).
 *
 * The store is created at import, but is inert (`enabled` false, nothing loaded) until
 * `module.ts` calls `audioStore.init(system)` on activation, which only happens with
 * the `audio` flag on.
 */
import { useSyncExternalStore } from 'react';
import { AudioStore } from '@bible/audio';
import type { FollowStore, PositionStore } from '@bible/audio';
import { desktopModulesPort, desktopReaderPort } from './desktopPorts';

export const audioStore = new AudioStore({ reader: desktopReaderPort, modules: desktopModulesPort });

/**
 * Re-render when the store notifies; returns `select(store)`. The selector runs on every
 * render, so it must be cheap and should return primitives or stable references.
 */
export function useAudio<T>(select: (s: AudioStore) => T, store: AudioStore = audioStore): T {
  useSyncExternalStore(store.subscribe, () => store.version);
  return select(store);
}

/** Position and duration (seconds): changes about five times a second while playing. */
export function usePosition(store: AudioStore = audioStore): Pick<PositionStore, 'position' | 'duration'> {
  const p = store.position;
  useSyncExternalStore(p.subscribe, () => p.version);
  return { position: p.position, duration: p.duration };
}

/** The pane and verse id being read (for the highlight and the follow-scroll). */
export function useFollow(store: AudioStore = audioStore): Pick<FollowStore, 'tabId' | 'verseId'> {
  const f = store.follow;
  useSyncExternalStore(f.subscribe, () => f.version);
  return { tabId: f.tabId, verseId: f.verseId };
}
