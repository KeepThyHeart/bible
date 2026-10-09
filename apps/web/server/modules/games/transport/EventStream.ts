/**
 * The server-sent events half of the transport.
 *
 * The downstream channel carries `ServerEvent` values and nothing else, and
 * almost all of them are snapshots. That is the whole reconnection strategy:
 * there is no replay buffer, no sequence number and no "catch me up from
 * event 412". A phone that locked, changed towers and came back opens a new
 * stream, receives a complete snapshot as its first event, and is correct.
 * Anything cleverer would need a durable log and would still be wrong the
 * first time a phone slept longer than the log.
 */

import type { PlayerId, ServerEvent, ServerTime } from '../../../../src/modules/games/shared/protocol.js';

/** The response surface an event stream needs. Express satisfies it. */
export interface StreamResponse {
  setHeader(name: string, value: string): void;
  write(chunk: string): boolean;
  end(): void;
  flushHeaders?(): void;
}

/** The response surface a plain JSON reply needs. Express satisfies it. */
export interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): void;
}

/** Just enough of a request to learn that the client went away. */
export interface StreamRequest {
  on(event: 'close', listener: () => void): void;
}

/**
 * `owner` distinguishes the two credentials that may open a screen stream:
 * the owner token (opens the control panel too, when the owner holds
 * control) or a display token (never does, whatever else is happening in
 * the room). See `HostToken`'s own doc comment in the protocol.
 */
export type SubscriberRole =
  | { kind: 'screen'; owner: boolean }
  | { kind: 'player'; playerId: PlayerId };

/**
 * What the broadcast path talks to. Keeping it this narrow means broadcasting
 * can be tested with a recording array in place of a socket.
 */
export interface Subscriber {
  readonly role: SubscriberRole;
  readonly closed: boolean;
  send(event: ServerEvent): void;
  close(): void;
}

/**
 * Long enough not to be chatter, short enough to beat the shortest idle
 * timeout commonly found in a proxy or a mobile network.
 */
const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * How soon a browser should retry after the stream drops. The default in most
 * browsers is a few seconds; saying it explicitly means the reconnect delay is
 * a decision rather than a browser detail.
 */
const RECONNECT_HINT_MS = 3_000;

export interface EventStreamOptions {
  heartbeatMs?: number;
  now?: () => ServerTime;
  /** Called exactly once, however the stream ends. */
  onClose?: () => void;
}

export class EventStream implements Subscriber {
  readonly role: SubscriberRole;

  private readonly res: StreamResponse;
  private readonly now: () => ServerTime;
  private readonly onClose: (() => void) | null;
  private heartbeat: NodeJS.Timeout | null = null;
  private ended = false;

  constructor(res: StreamResponse, role: SubscriberRole, options: EventStreamOptions = {}) {
    this.res = res;
    this.role = role;
    this.now = options.now ?? Date.now;
    this.onClose = options.onClose ?? null;

    res.setHeader('Content-Type', 'text/event-stream');
    // `no-transform` is the half that matters in the wild: plenty of
    // intermediaries will happily re-encode a body they were told not to
    // cache.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // nginx buffers proxied responses by default, which turns a live stream
    // into silence with no error anywhere. This header is how the stream asks
    // it not to.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    this.res.write(`retry: ${RECONNECT_HINT_MS}\n\n`);

    const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    if (heartbeatMs > 0) {
      this.heartbeat = setInterval(() => this.sendHeartbeat(), heartbeatMs);
      // A heartbeat must not be a reason for the process to stay alive; the
      // listening socket is.
      this.heartbeat.unref();
    }
  }

  get closed(): boolean {
    return this.ended;
  }

  /**
   * Every event goes out on the default message channel with its `type` inside
   * the payload, rather than as a named SSE event. One `onmessage` handler
   * then switches on the discriminated union the protocol already defines,
   * instead of the client having to register a listener per variant and
   * silently dropping any variant it forgot.
   */
  send(event: ServerEvent): void {
    if (this.ended) return;
    // No explicit flush: the compression middleware is filtered out for this
    // content type, so a write reaches the socket as it is made.
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  /** A comment line: bytes on the wire that no client handler ever sees. */
  comment(text: string): void {
    if (this.ended) return;
    this.res.write(`: ${text}\n\n`);
  }

  sendHeartbeat(): void {
    this.send({ type: 'heartbeat', serverTime: this.now() });
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.res.end();
    this.onClose?.();
  }
}

/**
 * Refuse a stream with an ordinary HTTP error, before any stream headers go
 * out.
 *
 * This matters more than the usual "return the right status" tidiness: an
 * `EventSource` retries a failed connection forever, on its own, with no way
 * for page code to distinguish "not yet" from "never". Opening a stream for a
 * room that does not exist and then closing it produces a phone that reconnects
 * to a dead code until its battery runs out. A 4xx with a body arrives once and
 * the client can show a human what happened.
 */
export function refuseStream(res: JsonResponse, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}
