/**
 * A read-only view of one session's state: the SSE stream every reader holds
 * (`/api/present/j/:joinCode/stream`), merged with same-machine
 * `BroadcastChannel` frames by the one version rule both sources share
 * (`isNewer`, see `frames.ts`).
 *
 * Extracted from what was, until this file existed, logic living only inside
 * `usePresentStream` -- a Preact hook, and therefore usable only from a
 * component. A follow-along tab needs the identical merge behaviour from a
 * plain store (`followStore.ts`, which is not a component and must not
 * pretend to be one just to hold a hook), so the merge itself lives here as
 * a plain, hook-free factory, and `usePresentStream` becomes a thin wrapper
 * that turns its events into component state.
 *
 * This is *read-only* on purpose, matching every caller: the projection
 * viewer, the controller's own preview, and a follow-along reader all watch a
 * session without driving it. The controller's own drive path (predicting
 * locally and POSTing intents) is a different shape entirely and stays in
 * `presentStore.ts` -- see the module comment there for why it does not use
 * this receiver either, even though it also opens the same stream.
 */

import { API_BASE } from '../../utils/apiUrl';
import type { PresentClosedPayload, PresentState } from '../protocol';
import { isNewer, renderEquivalent } from './frames';
import { openLocalChannel } from './localChannel';

export type ReceiverEvent =
  | { type: 'state'; state: PresentState }
  /** The stream dropped and is retrying. Not `closed`: the server said nothing. */
  | { type: 'reconnecting' }
  /** An explicit statement from the server. The only thing besides `state` that may change what a reader shows. */
  | { type: 'closed'; reason: PresentClosedPayload['reason'] };

export interface PresentReceiver {
  /** Learn about every event as it happens. Returns an unsubscribe. */
  subscribe(onEvent: (event: ReceiverEvent) => void): () => void;
  close(): void;
}

/**
 * `preview` marks this receiver as a mirror rather than an audience, keeping
 * it out of the viewer count -- see the `preview` query parameter in
 * `presentRoutes.ts`. Follow-along readers are real audience and pass nothing.
 */
export function openPresentReceiver(joinCode: string, options: { preview?: boolean } = {}): PresentReceiver {
  const listeners = new Set<(event: ReceiverEvent) => void>();
  const emit = (event: ReceiverEvent): void => {
    // Copied so a listener unsubscribing mid-dispatch (e.g. `close()` from
    // inside its own callback) cannot mutate the set this loop is iterating.
    for (const listener of [...listeners]) listener(event);
  };

  let latest: PresentState | null = null;
  let closedByServer = false;

  const source = new EventSource(
    `${API_BASE}/api/present/j/${encodeURIComponent(joinCode)}/stream${options.preview ? '?preview=1' : ''}`,
  );
  const localChannel = openLocalChannel(joinCode);

  function accept(state: PresentState, origin: 'network' | 'local'): void {
    if (!isNewer(latest, { origin, state })) return;
    // A network frame confirming exactly what a local prediction already
    // showed is not a second change -- see `renderEquivalent`. `latest` still
    // moves on (the network frame is definitely correct, and a later local
    // guess should be judged against it, not against the prediction it
    // confirmed), but subscribers are not re-told something they already saw.
    const redundant = latest !== null && renderEquivalent(latest, state);
    latest = state;
    if (redundant) return;
    emit({ type: 'state', state });
  }

  source.addEventListener('state', event => {
    let next: PresentState;
    try {
      next = JSON.parse((event as MessageEvent<string>).data) as PresentState;
    } catch {
      // A frame we cannot read is not a reason to change what is displayed.
      return;
    }
    accept(next, 'network');
  });

  const unsubscribeLocal = localChannel.subscribe(state => accept(state, 'local'));

  source.addEventListener('closed', event => {
    let reason: PresentClosedPayload['reason'] = 'ended';
    try {
      reason = (JSON.parse((event as MessageEvent<string>).data) as PresentClosedPayload).reason;
    } catch {
      // Fall back to the generic ending.
    }
    closedByServer = true;
    // Stop reconnecting: EventSource treats a closed stream as a failure to
    // retry rather than an answer, and there is nothing left to reconnect to.
    source.close();
    emit({ type: 'closed', reason });
  });

  source.onerror = () => {
    if (closedByServer) return;
    // Deliberately no payload: EventSource is already retrying on its own,
    // and every caller already knows what it last had.
    emit({ type: 'reconnecting' });
  };

  return {
    subscribe(onEvent) {
      listeners.add(onEvent);
      return () => listeners.delete(onEvent);
    },
    close() {
      source.close();
      unsubscribeLocal();
      localChannel.close();
    },
  };
}
