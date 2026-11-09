/**
 * A tiny local bibsearch stand-in for the Ideas (meaning) search checks: answers /v1/info and /v1/search
 * with a fixed list that holds one verse twice (Proverbs 19:17 as a one-verse paragraph row and as a verse
 * row) plus a real paragraph, all inside the committed fixture's chapters. Run directly to start one by hand:
 *   node e2e/qa-stub.ts [port]
 */
import http from 'node:http';

const ROWS = [
  { id: 'KJV.PRO.19.17', level: 'paragraph', ref: 'Proverbs 19:17' },
  { id: 'KJV.JHN.3.16-17', level: 'paragraph', ref: 'John 3:16-17' },
  { id: 'KJV.PRO.19.17', level: 'verse', ref: 'Proverbs 19:17' },
  { id: 'KJV.PSA.23.1-3', level: 'paragraph', ref: 'Psalm 23:1-3' },
];

export function startQaStub(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    req.resume();
    req.on('end', () => {
      if (url.pathname === '/v1/info') return send(200, { model: 'stub', dims: 8, rows: ROWS.length, modes: ['semantic', 'keyword'], translations: ['KJV'] });
      if (url.pathname === '/healthz' || url.pathname === '/readyz') return send(200, { ok: true });
      if (url.pathname !== '/v1/search') return send(404, { error: { code: 'not_found', message: 'not found' } });
      send(200, {
        query: url.searchParams.get('query'), model: 'stub', dims: 8, mode: 'semantic', degraded: false, cache_hit: false,
        timings_ms: { embed: 1, search: 1, total: 2 },
        results: ROWS.map((r, i) => ({ rank: i + 1, id: r.id, level: r.level, score: 0.8 - i * 0.05, ref: r.ref, translation: 'KJV', lang: 'en', text: 'stub text' })),
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

if (import.meta.filename === process.argv[1]) {
  const s = await startQaStub(Number(process.argv[2] ?? 8799));
  console.log(`qa stub on ${s.url}`);
}
