/**
 * The downstream half of the transport: an event stream, held in state.
 *
 * Every stream opens with a full snapshot, so there is no replay logic here and
 * no sequence numbers to reconcile — a reconnect is indistinguishable from a
 * phase change, and the hook simply renders whatever last arrived.
 *
 * The case this is built around is not a server going down. It is a phone that
 * locked, changed towers and came back thirty seconds later. Browsers throttle
 * timers in a backgrounded tab, so a backoff timer scheduled before the lock
 * may not fire for a long while after the screen comes on; becoming visible
 * therefore short-circuits the wait instead of waiting its turn.
 *
 * The stream is created through an injected factory rather than by calling
 * `EventSource` directly, because jsdom has no `EventSource` and a test that
 * cannot drop a connection on purpose is not testing reconnection.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type {
  ClientSnapshot,
  PersonalResult,
  RevealPayload,
  RoomCode,
  Standing,
} from '../../shared/protocol.js';
import { API } from '../../shared/protocol.js';

export interface StreamHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onError(): void;
}

export interface StreamHandle {
  close(): void;
}

export type StreamFactory = (url: string, handlers: StreamHandlers) => StreamHandle;

export const eventSourceFactory: StreamFactory = (url, handlers) => {
  const source = new EventSource(url);
  source.onopen = () => handlers.onOpen();
  source.onmessage = (event) => handlers.onMessage(String(event.data));
  source.onerror = () => handlers.onError();
  return { close: () => source.close() };
};

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'ended';

export interface RoomStream {
  status: StreamStatus;
  snapshot: ClientSnapshot | null;
  /** Latest reveal, cleared as soon as a snapshot for a later round arrives. */
  reveal: RevealPayload | null;
  yourResult: PersonalResult | null;
  /** Only ever present after a host asked for it. */
  fullStandings: Standing[] | null;
  /** Set once the room is over for this viewer: kicked, or closed. */
  ended: string | null;
  reconnectNow(): void;
}

export interface RoomStreamOptions {
  code: RoomCode | null;
  /** Session token for a player, host token for a host. Null waits. */
  token: string | null;
  factory?: StreamFactory;
}

/** Deterministic, and short at the start: most drops recover on the first try. */
const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000] as const;

interface StreamState {
  status: StreamStatus;
  snapshot: ClientSnapshot | null;
  reveal: RevealPayload | null;
  yourResult: PersonalResult | null;
  fullStandings: Standing[] | null;
  ended: string | null;
}

const IDLE: StreamState = {
  status: 'idle',
  snapshot: null,
  reveal: null,
  yourResult: null,
  fullStandings: null,
  ended: null,
};

export function streamUrl(code: RoomCode, token: string): string {
  return `${API.stream(code)}?token=${encodeURIComponent(token)}`;
}

/** A truncated or foreign frame is worth ignoring, not worth crashing on. */
function parseEvent(data: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record['type'] === 'string' ? record : null;
}

/**
 * `EventSource` reports every failure as the same bare error, so a room that no
 * longer exists (a server restart empties them) looks exactly like a dropped
 * connection and would be retried forever. Asking again with `fetch` is the only
 * way to see the status. Only a definite refusal ends the stream; anything else,
 * including this probe failing, is treated as a drop.
 */
async function refusalReason(url: string): Promise<string | null> {
  const controller = new AbortController();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) return 'That room no longer exists.';
    if (response.status === 401) return 'This device is no longer part of that room.';
    return null;
  } catch {
    return null;
  } finally {
    // A healthy stream never finishes; only the status line was wanted.
    controller.abort();
  }
}

export function useRoomStream(options: RoomStreamOptions): RoomStream {
  const { code, token } = options;
  const [state, setState] = useState<StreamState>(IDLE);

  // Held in a ref so that swapping in a different factory never tears down a
  // healthy stream; only the room and the token do that.
  const factoryRef = useRef<StreamFactory>(eventSourceFactory);
  factoryRef.current = options.factory ?? eventSourceFactory;

  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!code || !token) {
      setState(IDLE);
      return;
    }

    let stopped = false;
    let handle: StreamHandle | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    // Each connection carries a generation so a late error from a stream we
    // already abandoned cannot schedule a second reconnect.
    let generation = 0;

    const cancelRetry = () => {
      if (retry !== null) {
        clearTimeout(retry);
        retry = null;
      }
    };

    const apply = (data: string) => {
      const event = parseEvent(data);
      if (!event) return;
      switch (event['type']) {
        case 'snapshot': {
          const snapshot = event['snapshot'] as ClientSnapshot | undefined;
          if (!snapshot) return;
          setState((previous) => {
            // A reveal belongs to one round; the next round's snapshot retires it.
            const stale = previous.reveal !== null && previous.reveal.round !== snapshot.round;
            return {
              ...previous,
              status: 'open',
              snapshot,
              reveal: stale ? null : previous.reveal,
              yourResult: stale ? null : previous.yourResult,
            };
          });
          return;
        }
        case 'reveal': {
          const reveal = event['reveal'] as RevealPayload | undefined;
          if (!reveal) return;
          const yourResult = (event['yourResult'] as PersonalResult | null | undefined) ?? null;
          setState((previous) => ({ ...previous, reveal, yourResult }));
          return;
        }
        case 'standingsFull': {
          const standings = event['standings'];
          if (!Array.isArray(standings)) return;
          setState((previous) => ({ ...previous, fullStandings: standings as Standing[] }));
          return;
        }
        case 'kicked':
        case 'roomClosed': {
          const reason = typeof event['reason'] === 'string' ? event['reason'] : 'The room ended.';
          stopped = true;
          cancelRetry();
          handle?.close();
          handle = null;
          setState((previous) => ({ ...previous, status: 'ended', ended: reason }));
          return;
        }
        default:
          // Heartbeats and anything a newer server adds: nothing to render.
          return;
      }
    };

    const open = () => {
      if (stopped) return;
      cancelRetry();
      generation += 1;
      const mine = generation;
      setState((previous) => ({
        ...previous,
        status: previous.snapshot === null ? 'connecting' : 'reconnecting',
      }));
      handle = factoryRef.current(streamUrl(code, token), {
        onOpen() {
          if (stopped || mine !== generation) return;
          attempt = 0;
          setState((previous) => ({ ...previous, status: 'open' }));
        },
        onMessage(data) {
          if (stopped || mine !== generation) return;
          apply(data);
        },
        onError() {
          if (stopped || mine !== generation) return;
          if (options.factory !== undefined) {
            scheduleRetry();
            return;
          }
          void refusalReason(streamUrl(code, token)).then((reason) => {
            if (stopped || mine !== generation) return;
            if (reason === null) {
              scheduleRetry();
              return;
            }
            stopped = true;
            cancelRetry();
            handle?.close();
            handle = null;
            setState((previous) => ({ ...previous, status: 'ended', ended: reason }));
          });
        },
      });
    };

    const scheduleRetry = () => {
      if (stopped) return;
      handle?.close();
      handle = null;
      setState((previous) => ({ ...previous, status: 'reconnecting' }));
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 8000;
      attempt += 1;
      cancelRetry();
      retry = setTimeout(open, delay);
    };

    // A backgrounded tab's timers are throttled, so the wait we scheduled
    // before the screen locked is the wrong wait to still be honouring once
    // the phone is back in someone's hand.
    const wake = () => {
      if (stopped) return;
      if (retry === null) return;
      attempt = 0;
      open();
    };
    wakeRef.current = wake;

    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };

    document.addEventListener('visibilitychange', onVisible);
    addEventListener('online', wake);
    addEventListener('pageshow', onVisible);

    open();

    return () => {
      stopped = true;
      cancelRetry();
      handle?.close();
      handle = null;
      wakeRef.current = () => {};
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('online', wake);
      removeEventListener('pageshow', onVisible);
    };
  }, [code, token]);

  const reconnectNow = useCallback(() => wakeRef.current(), []);

  return {
    status: state.status,
    snapshot: state.snapshot,
    reveal: state.reveal,
    yourResult: state.yourResult,
    fullStandings: state.fullStandings,
    ended: state.ended,
    reconnectNow,
  };
}
