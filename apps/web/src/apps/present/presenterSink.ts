/**
 * Where the Presenter's actions go.
 *
 * Before going live there is no session, but the presenter can still prepare:
 * every action (show, next, blank, highlight, theme...) runs against a local,
 * offline copy of the session, and the pre-live preview draws that copy. Once
 * live, the same actions go to `presentStore`, and the wall is the real one.
 * `goLive` starts the real session and replays the local state into it, so
 * the screen opens where the presenter already was.
 *
 * The local session is the same reducer the server runs (`createLocalSession`),
 * kept under its own storage key so it never collides with the simple viewer's.
 */

import { useEffect, useState } from 'preact/hooks';
import { presentStore } from '../../stores/presentStore';
import { DEFAULT_FONT_STEP, type PresentIntent, type PresentItem, type PresentState } from '../../present/protocol';
import { createLocalSession, type LocalSession } from '../../present/solo/localSession';

export const PRELIVE_STORAGE_KEY = 'present-prelive';

let local: LocalSession | null = null;

/** The pre-live session, created on first use. */
export function getPreliveSession(): LocalSession {
  return (local ??= createLocalSession({ storageKey: PRELIVE_STORAGE_KEY }));
}

/** Tests: swap in (or clear) the pre-live session. */
export function setPreliveSessionForTests(session: LocalSession | null): void {
  local = session;
}

export function presenterIsLive(): boolean {
  return presentStore.session !== null;
}

let lastPost: Promise<unknown> = Promise.resolve();

/**
 * Resolves once the most recent live send has been answered (immediately when
 * nothing is in flight or before going live). Lets a caller that cannot hold
 * the promise itself (`notesStore.showPlanItem`) still order a follow-up intent
 * after it: live POSTs are not serialized, and `show` clears highlights.
 */
export function presenterSettled(): Promise<unknown> {
  return lastPost;
}

/** Send an intent to the live session, or, before going live, to the local one. Returns the live promise. */
export function presenterSend(intent: PresentIntent): void | Promise<unknown> {
  if (presenterIsLive()) {
    const posted = Promise.resolve(presentStore.send(intent));
    lastPost = posted.catch(() => undefined);
    return posted;
  }
  getPreliveSession().sink(intent);
}

/** Put an item up (same meaning as `presentStore.show`). */
export function presenterShow(item: PresentItem, index?: number): void | Promise<unknown> {
  return presenterSend({ type: 'show', item, index });
}

/** Blank or unblank, whichever is not the current state. */
export function presenterToggleBlank(): void {
  const blanked = presenterState()?.display.blanked ?? false;
  presenterSend({ type: blanked ? 'unblank' : 'blank' });
}

/** The state being presented: the live wall when live (null until the first frame), else the local copy. */
export function presenterState(): PresentState | null {
  return presenterIsLive() ? presentStore.wall : getPreliveSession().getState();
}

/** Called on any change to either source; returns the unsubscribe. */
export function subscribePresenter(fn: () => void): () => void {
  const offStore = presentStore.subscribe(fn);
  const offLocal = getPreliveSession().subscribe(() => fn());
  return () => { offStore(); offLocal(); };
}

export function usePresenterState(): PresentState | null {
  const [, setTick] = useState(0);
  useEffect(() => subscribePresenter(() => setTick(n => n + 1)), []);
  return presenterState();
}

/**
 * The intents that recreate a local state on a fresh session: theme and size
 * first (so the first frame is right), then the item at its position, its
 * highlights, and the blank flag. Empty for an untouched local session.
 */
export function seedIntents(state: PresentState): PresentIntent[] {
  const out: PresentIntent[] = [];
  if (state.display.theme !== 'light') out.push({ type: 'setTheme', theme: state.display.theme });
  if (state.display.fontStep !== DEFAULT_FONT_STEP) out.push({ type: 'setFontStep', fontStep: state.display.fontStep });
  if (state.live) {
    out.push({ type: 'show', item: state.live, index: state.position.index });
    for (const highlight of state.position.highlights) out.push({ type: 'addHighlight', highlight });
  }
  if (state.display.blanked) out.push({ type: 'blank' });
  return out;
}

/** Start the real session, then bring it to where the local one is. False when the session could not start. */
export async function goLive(): Promise<boolean> {
  const seed = seedIntents(getPreliveSession().getState());
  const ok = await presentStore.start();
  if (!ok) return false;
  for (const intent of seed) await presentStore.send(intent);
  return true;
}
