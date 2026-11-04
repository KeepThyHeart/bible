/**
 * The Presenter's screen server: a tiny HTTP server that serves one page and a
 * Server-Sent Events stream of snapshots. It has no knowledge of Scripture; the
 * module (`index.ts`) hands it whole snapshots to publish.
 *
 * Security model (this is a network listener inside a desktop app, so the defaults
 * are strict):
 *  - Binds to 127.0.0.1 only, unless the controller turns on LAN mode (then 0.0.0.0).
 *  - A random port every run, and an unguessable 192-bit token as the first path
 *    segment; every route lives under `/p/<token>/`, anything else is a bare 404
 *    (no hint that a server is there). The token is compared in constant time.
 *  - In local mode the `Host` header must be 127.0.0.1/localhost (with our port), which
 *    stops DNS-rebinding pages in the user's browser from reading the stream.
 *  - GET/HEAD only; no request body is ever read; no cookies; no CORS headers, so no
 *    other web origin can read responses. A strict CSP and `no-store` on every page.
 *  - The page renders verse text with `textContent`, never as HTML.
 *  - Bounded: a cap on open streams, and sockets are closed on stop.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo, Socket } from 'node:net';
import { VIEWER_CSS, VIEWER_HTML, VIEWER_JS } from './viewerPage';
import type { PresentSnapshot } from './types';

export const MAX_VIEWERS = 20;
export const HEARTBEAT_MS = 15_000;
const MAX_BUFFERED = 1_000_000;

export interface PresenterServerOptions {
  /** Listen on all interfaces (the local network). Default false: 127.0.0.1 only. */
  lan?: boolean;
  maxViewers?: number;
  heartbeatMs?: number;
  /** Called whenever the number of connected screens changes. */
  onViewers?: (count: number) => void;
}

export interface StartedServer {
  port: number;
  token: string;
  lan: boolean;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export class PresenterServer {
  private server: Server | null = null;
  private token = '';
  private port = 0;
  private lan = false;
  private host = '';
  private snapshot: PresentSnapshot | null = null;
  private readonly streams = new Set<ServerResponse>();
  private readonly sockets = new Set<Socket>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly options: PresenterServerOptions = {}) {}

  get running(): boolean {
    return this.server !== null;
  }

  /** The interface the socket is bound to (127.0.0.1 unless LAN mode). */
  get bindAddress(): string {
    return this.host;
  }

  get viewerCount(): number {
    return this.streams.size;
  }

  /** Path (starting with `/p/<token>/`) of the screen page; only valid while running. */
  get pagePath(): string {
    return `/p/${this.token}/`;
  }

  start(initial: PresentSnapshot): Promise<StartedServer> {
    if (this.server) return Promise.reject(new Error('Presenter server already running'));
    this.token = randomBytes(24).toString('base64url');
    this.lan = this.options.lan === true;
    this.snapshot = initial;
    const server = createServer((req, res) => this.handle(req, res));
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    // Slowloris guard: a request line + headers must arrive promptly.
    server.maxConnections = 64;
    server.headersTimeout = 10_000;
    server.requestTimeout = 10_000;
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', (err) => {
        this.server = null;
        reject(err);
      });
      // Port 0: the OS picks a random free port.
      this.host = this.lan ? '0.0.0.0' : '127.0.0.1';
      server.listen(0, this.host, () => {
        this.port = (server.address() as AddressInfo).port;
        this.heartbeat = setInterval(() => this.pulse(), this.options.heartbeatMs ?? HEARTBEAT_MS);
        this.heartbeat.unref?.();
        resolve({ port: this.port, token: this.token, lan: this.lan });
      });
    });
  }

  /** Send a new snapshot to every connected screen (and keep it for new ones). */
  publish(snapshot: PresentSnapshot): void {
    this.snapshot = snapshot;
    this.sendAll(snapshot);
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const res of this.streams) {
      try {
        res.write('event: closed\ndata: {}\n\n');
        res.end();
      } catch {
        /* peer already gone */
      }
    }
    this.streams.clear();
    this.options.onViewers?.(0);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Keep-alive sockets would hold close() open.
      for (const s of this.sockets) s.destroy();
      this.sockets.clear();
    });
    this.token = '';
    this.port = 0;
    this.snapshot = null;
  }

  // -------------------------------------------------------------------------

  private hostAllowed(req: IncomingMessage): boolean {
    if (this.lan) return true; // the token is the guard on a local network
    const host = (req.headers.host ?? '').toLowerCase();
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
  }

  private notFound(res: ServerResponse): void {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    try {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || !this.hostAllowed(req)) return this.notFound(res);
      const url = new URL(req.url ?? '/', 'http://x');
      const parts = url.pathname.split('/'); // ['', 'p', token, ...rest]
      if (parts[1] !== 'p' || !tokensEqual(parts[2] ?? '', this.token)) return this.notFound(res);
      const rest = parts.slice(3).join('/');
      switch (rest) {
        case '':
          return this.send(req, res, 'text/html; charset=utf-8', VIEWER_HTML);
        case 'viewer.js':
          return this.send(req, res, 'text/javascript; charset=utf-8', VIEWER_JS);
        case 'viewer.css':
          return this.send(req, res, 'text/css; charset=utf-8', VIEWER_CSS);
        case 'state':
          return this.send(req, res, 'application/json; charset=utf-8', JSON.stringify(this.withViewers(this.snapshot)));
        case 'events':
          if (req.method === 'HEAD') return this.send(req, res, 'text/event-stream; charset=utf-8', '');
          return this.openStream(req, res);
        default:
          return this.notFound(res);
      }
    } catch {
      this.notFound(res);
    }
  }

  private send(req: IncomingMessage, res: ServerResponse, type: string, body: string): void {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  private withViewers(snapshot: PresentSnapshot | null): PresentSnapshot | null {
    return snapshot ? { ...snapshot, viewerCount: this.streams.size } : null;
  }

  private openStream(req: IncomingMessage, res: ServerResponse): void {
    if (this.streams.size >= (this.options.maxViewers ?? MAX_VIEWERS)) {
      res.writeHead(503, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Too many screens');
      return;
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    this.streams.add(res);
    const gone = (): void => {
      if (this.streams.delete(res)) this.options.onViewers?.(this.streams.size);
    };
    req.on('close', gone);
    res.on('close', gone);
    if (this.snapshot) res.write(this.frame(this.snapshot));
    this.options.onViewers?.(this.streams.size);
  }

  private frame(snapshot: PresentSnapshot): string {
    return `event: state\ndata: ${JSON.stringify(this.withViewers(snapshot))}\n\n`;
  }

  private sendAll(snapshot: PresentSnapshot): void {
    const data = this.frame(snapshot);
    for (const res of this.streams) {
      try {
        // A stalled peer must not make us buffer snapshots forever.
        if (res.writableLength > MAX_BUFFERED) {
          this.streams.delete(res);
          res.destroy();
          continue;
        }
        res.write(data);
      } catch {
        this.streams.delete(res);
      }
    }
  }

  private pulse(): void {
    for (const res of this.streams) {
      try {
        res.write(': keepalive\n\n');
      } catch {
        this.streams.delete(res);
      }
    }
  }
}
