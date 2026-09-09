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
import { API_BASE } from '../utils/apiUrl';
import type { PresentClosedPayload, PresentState } from './protocol';

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

export function usePresentStream(joinCode: string): PresentConnection {
  const [connection, setConnection] = useState<PresentConnection>({ status: 'connecting' });

  // The last state, held outside React state so the event handlers can compare
  // versions without re-subscribing on every frame.
  const latest = useRef<PresentState | null>(null);

  useEffect(() => {
    if (!joinCode) return;

    const source = new EventSource(`${API_BASE}/api/present/j/${encodeURIComponent(joinCode)}/stream`);
    let closedByServer = false;

    source.addEventListener('state', event => {
      let next: PresentState;
      try {
        next = JSON.parse((event as MessageEvent<string>).data) as PresentState;
      } catch {
        // A frame we cannot read is not a reason to blank the wall.
        return;
      }

      // Versions are monotonic, so anything not newer is a duplicate or a
      // reordered delivery and is safe to drop. This is what makes reconnection
      // free: the server re-sends current state and the viewer either learns
      // something or ignores it.
      if (latest.current && next.version <= latest.current.version) return;

      latest.current = next;
      try {
        localStorage.setItem('present-viewer-theme', next.display.theme);
      } catch {
        // Private mode. Costs a themed flash on the next load, nothing more.
      }
      setConnection({ status: 'live', state: next });
    });

    source.addEventListener('closed', event => {
      let reason: PresentClosedPayload['reason'] = 'ended';
      try {
        reason = (JSON.parse((event as MessageEvent<string>).data) as PresentClosedPayload).reason;
      } catch {
        // Fall back to the generic ending.
      }
      closedByServer = true;
      // Stop reconnecting. Without this the projector would retry all night
      // after a service, because EventSource treats a closed stream as a
      // failure to retry rather than an answer.
      source.close();
      setConnection({ status: 'closed', reason, state: latest.current });
    });

    source.onerror = () => {
      if (closedByServer) return;
      // Deliberately silent: EventSource is already retrying, and the viewer
      // goes on showing whatever it last had.
      if (latest.current) setConnection({ status: 'reconnecting', state: latest.current });
    };

    return () => source.close();
  }, [joinCode]);

  return connection;
}

/** The state currently on the wall, whatever the connection is doing. */
export function displayedState(connection: PresentConnection): PresentState | null {
  return connection.status === 'connecting' ? null : connection.state;
}
