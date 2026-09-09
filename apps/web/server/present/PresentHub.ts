/**
 * The live layer: who is currently watching each session, and how state reaches
 * them.
 *
 * Purely in-memory, and deliberately so. Everything here is a fact about open
 * sockets, which a restart makes false; the durable half lives in
 * `PresentStore`. Keeping them apart is what stops a server restart from
 * resurrecting a viewer count for people who left an hour ago.
 *
 * The transport is Server-Sent Events rather than WebSockets. The traffic is
 * one-way (the controller writes over ordinary POSTs), SSE reconnects itself
 * without a library on either side, and it is plain HTTP -- so it survives the
 * proxies and captive portals that venue wifi puts in the way.
 */

import {
  SSE_HEARTBEAT_MS,
  SSE_RETRY_MS,
  type PresentClosedPayload,
  type PresentState,
} from '../../src/present/protocol.js';

/**
 * The slice of an Express `Response` this needs.
 *
 * Narrow on purpose: the hub is the piece with the timing-sensitive behaviour,
 * and it should be testable with a two-method fake rather than a mocked HTTP
 * server.
 */
export interface SseSink {
  write(chunk: string): boolean;
  end(): void;
}

/**
 * Hard ceilings on open streams.
 *
 * Note what is *not* here: a per-IP cap. Every follow-along device in a church
 * hall is behind one NAT, so the whole congregation shares a single public
 * address -- a per-IP limit tight enough to stop an attacker would lock out the
 * sixth person in the pews, and one loose enough to seat a congregation would
 * not stop anything. The per-session and global caps bound resource use without
 * that failure mode.
 */
export const DEFAULT_MAX_VIEWERS_PER_SESSION = 50;
export const DEFAULT_MAX_TOTAL_VIEWERS = 500;

export interface Subscription {
  /** Detach and stop writing to this sink. Idempotent. */
  close(): void;
}

export type SubscribeResult =
  | { ok: true; subscription: Subscription }
  | { ok: false; reason: 'session-full' | 'server-full' };

/**
 * Format one SSE frame.
 *
 * `JSON.stringify` can never emit a raw newline, so the payload is always a
 * single `data:` line and no chunking is needed. That is worth stating, because
 * hand-rolled SSE writers that forget it truncate every message at the first
 * line break.
 */
function frame(event: string, payload: unknown, id?: number): string {
  const idLine = id === undefined ? '' : `id: ${id}\n`;
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

interface Client {
  sink: SseSink;
  closed: boolean;
}

export class PresentHub {
  private readonly clients = new Map<string, Set<Client>>();
  private total = 0;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly maxPerSession: number = DEFAULT_MAX_VIEWERS_PER_SESSION,
    private readonly maxTotal: number = DEFAULT_MAX_TOTAL_VIEWERS,
    heartbeatMs: number = SSE_HEARTBEAT_MS,
  ) {
    // A comment frame costs two bytes on the wire and is what keeps an idle
    // connection alive through proxies that drop quiet sockets. It doubles as
    // the only way to notice a peer that vanished without a FIN: the write
    // fails and the client is reaped.
    this.heartbeat = setInterval(() => this.pulse(), heartbeatMs);
    this.heartbeat.unref?.();
  }

  /**
   * Attach a sink to a session and send it the current state immediately.
   *
   * The initial send is part of subscribing rather than a separate call because
   * a viewer that connects and then waits for the next intent shows a blank
   * wall until the presenter happens to touch something.
   */
  subscribe(sessionId: string, sink: SseSink, state: PresentState): SubscribeResult {
    if (this.total >= this.maxTotal) return { ok: false, reason: 'server-full' };

    let set = this.clients.get(sessionId);
    // Read the size through the absent case rather than guarding on `set`
    // being present: with the guard the other way round, a cap of zero admits
    // the first subscriber of every session, because there is no set yet to
    // measure.
    if ((set?.size ?? 0) >= this.maxPerSession) return { ok: false, reason: 'session-full' };
    if (!set) {
      set = new Set();
      this.clients.set(sessionId, set);
    }

    const client: Client = { sink, closed: false };
    set.add(client);
    this.total++;

    const detach = (): void => {
      if (client.closed) return;
      client.closed = true;
      const current = this.clients.get(sessionId);
      if (current?.delete(client)) {
        this.total--;
        if (current.size === 0) this.clients.delete(sessionId);
      }
    };

    // `retry:` before anything else, so a client that drops during the very
    // first frame still comes back on our schedule rather than the browser's
    // default.
    try {
      sink.write(`retry: ${SSE_RETRY_MS}\n\n`);
      sink.write(frame('state', this.withCount(sessionId, state), state.version));
    } catch {
      detach();
      return { ok: false, reason: 'server-full' };
    }

    return { ok: true, subscription: { close: detach } };
  }

  /** Push new state to every subscriber of one session. */
  broadcast(sessionId: string, state: PresentState): void {
    this.send(sessionId, frame('state', this.withCount(sessionId, state), state.version));
  }

  /**
   * Tell a session's viewers it is over, then hang up.
   *
   * This is the only event other than new state that may change what is on the
   * wall. A dropped connection must leave the display exactly as it was --
   * viewers reconnect silently and never render an error, because a stack trace
   * on a screen in front of a congregation is worse than a stale verse.
   */
  closeSession(sessionId: string, reason: PresentClosedPayload['reason']): void {
    const set = this.clients.get(sessionId);
    if (!set) return;

    const payload = frame('closed', { reason });
    for (const client of [...set]) {
      try {
        client.sink.write(payload);
        client.sink.end();
      } catch {
        // Already gone; the reap below is what matters.
      }
      client.closed = true;
      this.total--;
    }
    this.clients.delete(sessionId);
  }

  viewerCount(sessionId: string): number {
    return this.clients.get(sessionId)?.size ?? 0;
  }

  totalViewers(): number {
    return this.total;
  }

  /** Stop the heartbeat and drop every connection. For shutdown and tests. */
  dispose(): void {
    clearInterval(this.heartbeat);
    for (const sessionId of [...this.clients.keys()]) {
      const set = this.clients.get(sessionId);
      if (!set) continue;
      for (const client of set) {
        client.closed = true;
        try {
          client.sink.end();
        } catch {
          // Nothing useful to do while tearing down.
        }
      }
    }
    this.clients.clear();
    this.total = 0;
  }

  /**
   * Stamp the live viewer count onto outgoing state.
   *
   * The hub is the only thing that knows this number, so it fills it in rather
   * than trusting whatever the caller computed. That also fixes the awkward
   * case at the edge: a viewer's own first frame is built before it has
   * finished subscribing, and would otherwise tell it there is nobody watching
   * -- itself included.
   */
  private withCount(sessionId: string, state: PresentState): PresentState {
    const viewerCount = this.clients.get(sessionId)?.size ?? 0;
    if (state.session.viewerCount === viewerCount) return state;
    return { ...state, session: { ...state.session, viewerCount } };
  }

  private send(sessionId: string, payload: string): void {
    const set = this.clients.get(sessionId);
    if (!set) return;
    for (const client of [...set]) {
      this.writeOrReap(sessionId, client, payload);
    }
  }

  private pulse(): void {
    for (const [sessionId, set] of [...this.clients]) {
      for (const client of [...set]) {
        this.writeOrReap(sessionId, client, ': heartbeat\n\n');
      }
    }
  }

  /**
   * Write to one client, dropping it if the socket is gone.
   *
   * A leaked SSE response is the classic way an endpoint like this survives
   * testing and then falls over after a few hours in production, so a failed
   * write reaps rather than logs.
   */
  private writeOrReap(sessionId: string, client: Client, payload: string): void {
    if (client.closed) return;
    let ok = false;
    try {
      ok = client.sink.write(payload) !== false;
    } catch {
      ok = false;
    }
    // `write` returning false only means the buffer is full, which is normal
    // backpressure -- but for a stream this small it means the peer has stopped
    // reading, and holding the socket open helps nobody.
    if (ok) return;

    client.closed = true;
    const set = this.clients.get(sessionId);
    if (set?.delete(client)) {
      this.total--;
      if (set.size === 0) this.clients.delete(sessionId);
    }
    try {
      client.sink.end();
    } catch {
      // Already destroyed.
    }
  }
}
