/**
 * Default network corpus for smoke testing.
 *
 * Like the storage corpus these fixtures describe a *mode* the harness
 * configures before running a hook, not direct hook inputs. Item 3 will
 * inject these into a mock `fetch` so `network:*` hooks see realistic
 * success/failure/timeout behavior without hitting the wire.
 */

export type NetworkResponseKind = 'success' | 'notFound' | 'serverError' | 'timeout' | 'offline';

export interface NetworkFixture {
  id: string;
  kind: NetworkResponseKind;
  description: string;
  /** HTTP status. Omitted for `timeout` and `offline`. */
  status?: number;
  /** Response body. `undefined` for non-success kinds unless an error envelope matters. */
  body?: string;
  /** Content-Type to advertise on the response. */
  contentType?: string;
  /** Simulated server delay. For `timeout`, larger than any reasonable hook budget. */
  delayMs?: number;
  /** When `true` the mock raises a network-level error (DNS, no route, etc.). */
  networkError?: boolean;
}

export const DEFAULT_NETWORK_CORPUS: readonly NetworkFixture[] = Object.freeze([
  {
    id: 'success-json',
    kind: 'success',
    description: '200 OK with a small JSON payload.',
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { verse: 43003016, text: 'For God so loved...' } }),
    delayMs: 5,
  },
  {
    id: 'success-empty',
    kind: 'success',
    description: '200 OK with empty body.',
    status: 200,
    contentType: 'application/json',
    body: '',
    delayMs: 5,
  },
  {
    id: 'success-large',
    kind: 'success',
    description: '200 OK with ~256KB payload (exercises streaming/parse budgets).',
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, payload: 'x'.repeat(256 * 1024) }),
    delayMs: 20,
  },
  {
    id: 'not-found',
    kind: 'notFound',
    description: '404 — upstream did not recognize the resource.',
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'not_found' }),
    delayMs: 5,
  },
  {
    id: 'server-error',
    kind: 'serverError',
    description: '500 — upstream crashed mid-request.',
    status: 500,
    contentType: 'text/plain',
    body: 'Internal Server Error',
    delayMs: 5,
  },
  {
    id: 'rate-limited',
    kind: 'serverError',
    description: '429 with Retry-After — hook should back off, not crash.',
    status: 429,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'rate_limited', retryAfter: 30 }),
    delayMs: 5,
  },
  {
    id: 'slow-timeout',
    kind: 'timeout',
    description: 'Server never responds within hook budget.',
    delayMs: 60_000,
  },
  {
    id: 'offline',
    kind: 'offline',
    description: 'No network — fetch rejects with a connection error.',
    networkError: true,
  },
  {
    id: 'malformed-body',
    kind: 'success',
    description: '200 OK with invalid JSON (Content-Type claims JSON).',
    status: 200,
    contentType: 'application/json',
    body: '{not: valid JSON',
    delayMs: 5,
  },
]);
