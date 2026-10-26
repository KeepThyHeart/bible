#!/usr/bin/env node
/**
 * A tiny local HTTP stub that answers like the hosted bibsearch API
 * (`GET|POST /v1/search`, `GET /v1/info`, `/healthz`), for the remote-semantic
 * e2e tests (task 0190). No dependencies; do not depend on a live bibsearch.
 *
 *   import { startBibsearchStub } from '../../../scripts/bibsearch-stub.mjs';
 *   const stub = await startBibsearchStub({ port: 0 });
 *   stub.url            // http://127.0.0.1:<port>
 *   stub.requests       // every /v1/* request seen: { method, path, query, headers, body }
 *   stub.setMode('quota') // ok | degraded | routed | quota | ratelimit | banned | error502 | down | budget
 *   await stub.close();
 *
 * Also controllable over HTTP so a separate process (the web server under test,
 * Electron) can be inspected: `GET /__requests`, `DELETE /__requests`,
 * `POST /__mode {"mode": "quota"}`.
 *
 * Run standalone: `node scripts/bibsearch-stub.mjs [port]`.
 */
import http from 'node:http';

const CANNED = [
  { id: 'KJV.MAT.6.14', ref: 'Matthew 6:14', words: ['forgive', 'forgiving', 'forgiveness', 'wrong', 'trespass'] },
  { id: 'KJV.EPH.4.32', ref: 'Ephesians 4:32', words: ['forgive', 'forgiving', 'kind', 'tender'] },
  { id: 'KJV.COL.3.13', ref: 'Colossians 3:13', words: ['forgive', 'forgiving', 'quarrel'] },
  { id: 'KJV.JHN.3.16-17', ref: 'John 3:16-17', words: ['love', 'loved', 'salvation', 'eternal', 'life'] },
  { id: 'KJV.PSA.23.1-3', ref: 'Psalm 23:1-3', words: ['comfort', 'shepherd', 'peace', 'rest', 'anxious', 'worry'] },
  { id: 'KJV.PHP.4.6-7', ref: 'Philippians 4:6-7', words: ['anxious', 'worry', 'peace', 'prayer'] },
  { id: 'KJV.1CO.13.4', ref: '1 Corinthians 13:4', words: ['love', 'patient', 'kind'] },
  { id: 'KJV.ROM.8.28', ref: 'Romans 8:28', words: ['purpose', 'good', 'hardship', 'trust'] },
  // A facet row: bibsearch returns the best-scoring facet, whose id carries a suffix the
  // client cannot parse, so it maps through `passage` / `start` / `end` instead.
  {
    id: 'KJV.GEN.1.1#s0', ref: 'Genesis 1:1', words: ['creation', 'beginning', 'created', 'heaven'],
    extra: { passage: 'KJV.GEN.1.1', start: 1001001, end: 1001001, level: 'verse', facet: 'sub' },
  },
];

export function startBibsearchStub({ port = 0, host = '127.0.0.1' } = {}) {
  const state = { mode: 'ok', requests: [], quotaLeft: 50 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stub');
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
      'Access-Control-Expose-Headers': 'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, X-Request-Id',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...extra });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (url.pathname === '/__requests') {
        if (req.method === 'DELETE') { state.requests.length = 0; return send(200, { ok: true }); }
        return send(200, state.requests);
      }
      if (url.pathname === '/__mode') {
        try { state.mode = JSON.parse(raw).mode; } catch { /* keep */ }
        return send(200, { mode: state.mode });
      }
      if (url.pathname === '/healthz' || url.pathname === '/readyz') return send(200, { ok: true });

      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
      state.requests.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
      });

      if (url.pathname === '/v1/info') {
        return send(200, { model: 'stub-embedding', dims: 8, rows: CANNED.length, modes: ['semantic', 'keyword'], translations: ['KJV'] });
      }
      if (url.pathname !== '/v1/search') return send(404, { error: { code: 'not_found', message: 'not found' } });

      const err = (status, code, extra = {}, headers = {}) =>
        send(status, { error: { code, message: code, ...extra } }, headers);
      switch (state.mode) {
        case 'quota': return err(429, 'quota_exceeded', {}, { 'Retry-After': '7200', 'RateLimit-Reset': '7200', 'RateLimit-Remaining': '0' });
        case 'ratelimit': return err(429, 'rate_limited', {}, { 'Retry-After': '1' });
        case 'banned': return err(403, 'banned', {}, { 'Retry-After': '3600' });
        case 'error502': return err(502, 'embedder_error');
        case 'budget': return err(503, 'budget_exhausted', {}, { 'Retry-After': '600' });
        case 'down': return req.destroy();
        default: break;
      }

      const query = String(url.searchParams.get('query') ?? body?.query ?? '').toLowerCase();
      const k = Number(url.searchParams.get('k') ?? body?.k ?? 10);
      const words = query.split(/[^a-z']+/).filter(Boolean);
      let rows = CANNED.map((c) => ({ c, hits: c.words.filter((w) => words.some((q) => w.startsWith(q.slice(0, 5)))).length }));
      rows.sort((a, b) => b.hits - a.hits);
      if (!rows.some((r) => r.hits > 0)) rows = CANNED.map((c) => ({ c, hits: 0 }));
      const results = rows.slice(0, k).map((r, i) => ({
        rank: i + 1, id: r.c.id, score: Math.round((0.82 - i * 0.05) * 1000) / 1000, ref: r.c.ref, translation: 'KJV', lang: 'en',
        ...r.c.extra,
      }));
      if (url.searchParams.get('include_text') === 'true' || body?.include_text === true) {
        results.forEach((r) => { r.text = 'stub text'; });
      }
      state.quotaLeft = Math.max(0, state.quotaLeft - 1);
      const headers = {
        'RateLimit-Limit': '50',
        'RateLimit-Remaining': String(state.quotaLeft),
        'RateLimit-Reset': '43200',
      };
      send(200, {
        query: url.searchParams.get('query') ?? body?.query,
        model: 'stub-embedding', dims: 8,
        mode: state.mode === 'degraded' || state.mode === 'routed' ? 'keyword' : 'semantic',
        degraded: state.mode === 'degraded',
        ...(state.mode === 'routed' ? { routed: 'one_word' } : {}),
        cache_hit: false, timings_ms: { embed: 1, search: 1, total: 2 },
        results,
      }, headers);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const base = `http://${host}:${addr.port}`;
      resolve({
        url: base,
        port: addr.port,
        get requests() { return state.requests; },
        clearRequests() { state.requests.length = 0; },
        setMode(m) { state.mode = m; },
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stub = await startBibsearchStub({ port: Number(process.argv[2] ?? 8787) });
  console.log(`bibsearch stub on ${stub.url}`);
}
