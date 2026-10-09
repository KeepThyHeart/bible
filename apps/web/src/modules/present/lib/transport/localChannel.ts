/**
 * A same-machine sink and source for present frames: `BroadcastChannel`,
 * scoped to one session's join code.
 *
 * This is the whole of the "non-network-reliant" path the spec asks for: a
 * controller and a screen open in two tabs of the same browser exchange state
 * directly, with no round trip to the server and therefore no dependency on
 * the venue's wifi being up. It is additive, never authoritative -- the
 * network stream remains the source of truth, and `isNewer` (`frames.ts`) is
 * what lets a receiver mix the two without ever going backwards. See
 * `presentStore.ts` (`publishLocal`) for what is, and is not, safe to publish
 * this way.
 *
 * `BroadcastChannel` needs the same origin and the same browser profile,
 * which is exactly the case this exists for: a laptop driving a second window
 * on the projector output. It does not reach a phone in the room, which is
 * fine -- that device was never going to be on this bus, and it already has
 * the SSE stream.
 *
 * Guarded throughout: `BroadcastChannel` does not exist in every environment
 * (older Safari, some embedded webviews), and this must degrade to "no local
 * channel" rather than throw.
 */

import type { PresentState } from '../protocol';

const CHANNEL_PREFIX = 'kth-present:';

export interface LocalChannel {
  /** Tell every other tab on this channel what the wall should now show. */
  publish(state: PresentState): void;
  /** Learn about state published by another tab. Returns an unsubscribe. */
  subscribe(onState: (state: PresentState) => void): () => void;
  close(): void;
}

const NOOP_CHANNEL: LocalChannel = {
  publish() { /* No channel: nothing to tell. */ },
  subscribe() { return () => { /* Nothing was subscribed. */ }; },
  close() { /* Nothing to close. */ },
};

function isPresentState(value: unknown): value is PresentState {
  return typeof value === 'object' && value !== null && typeof (value as { version?: unknown }).version === 'number';
}

/** Open the local channel for one session's join code. Never throws. */
export function openLocalChannel(joinCode: string): LocalChannel {
  if (typeof BroadcastChannel === 'undefined' || !joinCode) return NOOP_CHANNEL;

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(CHANNEL_PREFIX + joinCode);
  } catch {
    // A browser that lied about supporting the constructor. Presenting must
    // still work without the local fast path.
    return NOOP_CHANNEL;
  }

  let closed = false;

  return {
    publish(state) {
      if (closed) return;
      try {
        channel.postMessage(state);
      } catch {
        // A worst-case serialization or browser quirk, not a reason to break
        // presenting: the network path still carries this update.
      }
    },
    subscribe(onState) {
      const handler = (event: MessageEvent<unknown>): void => {
        if (isPresentState(event.data)) onState(event.data);
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        channel.close();
      } catch {
        // Already gone.
      }
    },
  };
}
