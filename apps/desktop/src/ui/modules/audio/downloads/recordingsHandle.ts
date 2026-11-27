/**
 * The recorded channel's manifest source and URL scheme, for the downloads picker.
 * `module.ts` sets it after building the audio system (`system.recordings`) and clears it on dispose;
 * until then (flag off, or no recordings configured) the picker shows "no recordings".
 */
import type { AudioSystem } from '@bible/audio';

export type DesktopRecordings = NonNullable<AudioSystem['recordings']>;

let current: DesktopRecordings | undefined;
const listeners = new Set<() => void>();

export function setDesktopRecordings(recordings: DesktopRecordings | undefined): void {
  current = recordings;
  for (const l of listeners) l();
}

export const getDesktopRecordings = (): DesktopRecordings | undefined => current;

export function subscribeDesktopRecordings(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
