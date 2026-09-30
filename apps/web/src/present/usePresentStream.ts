/**
 * The viewer's half of the presenter protocol: hold an SSE stream open and turn
 * it into current state.
 *
 * The governing rule is that **a connection problem must never change what is
 * on the wall**. `EventSource` reconnects on its own; this hook keeps the last
 * state it saw through every drop, and only a `closed` event -- an explicit
 * statement from the server -- ends the display. Anything else would put a
 * spinner or an error in front of a congregation over a two-second wifi blip.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { PresentClosedPayload, PresentState } from './protocol';
import { openPresentReceiver } from './transport/receiver';

export type PresentConnection =
  /** Never yet received state. The lobby is showing. */
  | { status: 'connecting' }
  | { status: 'live'; state: PresentState }
  /**
   * Was live, is not now. `state` is retained on purpose: the viewer keeps
   * rendering it, and nothing on screen changes.
   */
  | { status: 'reconnecting'; state: PresentState }
  | { status: 'closed'; reason: PresentClosedPayload['reason']; state: PresentState | null };

/**
 * `preview` marks a stream as a mirror rather than an audience, keeping the
 * controller's preview pane out of the viewer count. See the `preview` query
 * parameter in `presentRoutes.ts`.
 */
export function usePresentStream(joinCode: string, preview = false): PresentConnection {
  const [connection, setConnection] = useState<PresentConnection>({ status: 'connecting' });

  // The last state, held outside React state so the event handlers can compare
  // versions without re-subscribing on every frame.
  const latest = useRef<PresentState | null>(null);

  useEffect(() => {
    if (!joinCode) return;

    // Same-machine screens (and the controller's own preview) also learn about
    // state the instant a same-browser controller predicts it, over
    // `BroadcastChannel` -- no wait for a round trip to the server. Merging
    // that with the network stream by one version rule (so this can never
    // contradict what the network eventually says) is `openPresentReceiver`'s
    // whole job; see `transport/receiver.ts`.
    const receiver = openPresentReceiver(joinCode, { preview });

    const unsubscribe = receiver.subscribe(event => {
      if (event.type === 'state') {
        latest.current = event.state;
        try {
          localStorage.setItem('present-viewer-theme', event.state.display.theme);
        } catch {
          // Private mode. Costs a themed flash on the next load, nothing more.
        }
        setConnection({ status: 'live', state: event.state });
      } else if (event.type === 'reconnecting') {
        // Deliberately silent otherwise: EventSource is already retrying, and
        // the viewer goes on showing whatever it last had.
        if (latest.current) setConnection({ status: 'reconnecting', state: latest.current });
      } else {
        setConnection({ status: 'closed', reason: event.reason, state: latest.current });
      }
    });

    return () => {
      unsubscribe();
      receiver.close();
    };
  }, [joinCode, preview]);

  return connection;
}

/** The state currently on the wall, whatever the connection is doing. */
export function displayedState(connection: PresentConnection): PresentState | null {
  return connection.status === 'connecting' ? null : connection.state;
}
