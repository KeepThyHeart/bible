/** A tiny in-memory stand-in for the sync server, as a `fetch`: just enough routes for DesktopSyncService tests. */
import type { Sync } from '@bible/core';

const PREFIX = '/api/sync/v1';

export interface FakeSyncServer {
  fetch: typeof fetch;
  /** Every pushed record (id -> seq). */
  records: Map<string, number>;
  pushRequests: number;
  /** Total records sent in push requests. */
  pushedRecords: number;
  /** Requests seen, "METHOD /route". */
  calls: string[];
  /** Hold the answer of `GET /changes` until released (pause tests). */
  holdChanges: { release(): void } | null;
  hold(): void;
  signedOut: number;
  nextDevices: Sync.DevicesResponse['devices'];
}

const json = (v: unknown, status = 200): Response =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

export function createFakeSyncServer(): FakeSyncServer {
  let account: { email: string; accountId: string; material: Sync.SignupRequest['material'] } | null = null;
  let seq = 0;
  let releaseFn: (() => void) | null = null;
  const server: FakeSyncServer = {
    records: new Map(), pushRequests: 0, pushedRecords: 0, calls: [], holdChanges: null, signedOut: 0, nextDevices: [],
    hold() {
      const gate = new Promise<void>((r) => { releaseFn = r; });
      this.holdChanges = { release: () => { releaseFn?.(); this.holdChanges = null; } };
      (this as unknown as { gate: Promise<void> }).gate = gate;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? 'GET';
      const route = url.pathname.slice(PREFIX.length);
      server.calls.push(`${method} ${route}`);
      const headers = new Headers(init?.headers);
      const authed = (headers.get('authorization') ?? '').startsWith('Bearer tok-');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const session = (): Response => json({
        accountId: account!.accountId, emailVerified: true, wrappedAk: account!.material.wrappedAkPassword,
        wrappedRecordIdKey: account!.material.wrappedRecordIdKey, keysets: account!.material.keysets,
        currentEpoch: account!.material.currentEpoch, token: 'tok-1',
      });
      switch (`${method} ${route}`) {
        case 'GET /info':
          return json({ apiVersion: 1, signupOpen: true, quotaBytes: 1e9, minAge: 13, minKdf: { m: 19456, t: 2 } });
        case 'POST /signup':
          account = { email: body.email, accountId: body.accountId, material: body.material };
          return session();
        case 'POST /prelogin':
          return account ? json({ kdf: account.material.kdf }) : json({ error: 'bad_request' }, 400);
        case 'POST /login':
          if (!account || body.authKey !== account.material.authKey) return json({ error: 'unauthorized' }, 401);
          return session();
        case 'POST /logout':
          server.signedOut++;
          return new Response(null, { status: 204 });
        case 'PUT /devices/current':
        case 'POST /reset':
        case 'POST /resend-verification':
          return new Response(null, { status: 204 });
        case 'GET /devices':
          return authed ? json({ devices: server.nextDevices }) : json({ error: 'unauthorized' }, 401);
        case 'GET /account':
          return authed
            ? json({ email: account?.email ?? '', emailVerified: true, bytesUsed: 0, quotaBytes: 1e9, createdAt: '2026-01-01T00:00:00Z', recordCount: server.records.size })
            : json({ error: 'unauthorized' }, 401);
        case 'GET /changes': {
          if (!authed) return json({ error: 'unauthorized' }, 401);
          const since = Number(url.searchParams.get('since') ?? 0);
          const gate = (server as unknown as { gate?: Promise<void> }).gate;
          if (server.holdChanges && gate) await gate;
          return json({ records: [], next: since, more: false });
        }
        case 'POST /push': {
          if (!authed) return json({ error: 'unauthorized' }, 401);
          server.pushRequests++;
          const accepted: Array<{ id: string; seq: number }> = [];
          for (const r of body.records as Array<{ id: string }>) {
            server.pushedRecords++;
            server.records.set(r.id, ++seq);
            accepted.push({ id: r.id, seq });
          }
          return json({ accepted, conflicts: [] });
        }
        default:
          return json({ error: 'not_found' }, 404);
      }
    }) as typeof fetch,
  };
  return server;
}
