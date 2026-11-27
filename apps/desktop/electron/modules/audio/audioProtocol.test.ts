import { describe, it, expect } from 'vitest';
import { createAudioHandler, parseRange, routeOf, safeSegments, toEsModule, type AudioProtocolDeps } from './audioProtocol';

const enc = (s: string) => Buffer.from(s, 'utf8');

function setup(opts: { files?: Record<string, Buffer>; assets?: Record<string, string>; base?: string | null; upstream?: AudioProtocolDeps['fetchUpstream'] } = {}) {
  const files = opts.files ?? {};
  const calls: Array<{ url: string; range: string | null }> = [];
  const deps: AudioProtocolDeps = {
    resolveAsset: async (id, p) => opts.assets?.[`${id}:${p}`] ?? null,
    downloadsRoot: () => '/dl',
    recordingsBase: () => (opts.base === undefined ? null : opts.base),
    fetchUpstream: async (url, range) => {
      calls.push({ url, range });
      if (opts.upstream) return opts.upstream(url, range);
      return { status: 200, headers: { 'content-type': 'audio/ogg', 'content-length': '3' }, body: new Uint8Array([1, 2, 3]) };
    },
    statFile: async (p) => files[p]?.length ?? null,
    openFile: (p, s, e) => new Uint8Array(files[p]!.subarray(s, e + 1)),
    readText: async (p) => files[p]!.toString('utf8'),
    joinPath: (root, ...parts) => [root, ...parts].join('/'),
  };
  const h = createAudioHandler(deps);
  const get = (path: string, init: RequestInit & { host?: string } = {}) =>
    h(new Request(`kth-audio://${init.host ?? 'app'}/audio/${path}`, init));
  return { get, calls };
}

describe('routing helpers', () => {
  it('refuses traversal, dotfiles, absolute and odd paths', () => {
    for (const p of ['/audio/../x', '/audio/v1/../x', '/audio/v1/%2e%2e/x', '/audio/v1/.hidden', '/audio/v1//x', '/audio/v1/a\\b', '/audio/C:/x', '/audio/v1/%E0%A4%A', '/other/x', '/audio/']) {
      expect(safeSegments(p), p).toBeNull();
    }
    expect(safeSegments('/audio/v1/kjv/index.json')).toEqual(['v1', 'kjv', 'index.json']);
  });
  it('maps routes', () => {
    expect(routeOf(['tts', 'piper', 'runtime', 'ort.wasm.min.mjs'])).toEqual({ kind: 'asset', assetId: 'piper-runtime', assetPath: 'runtime/ort.wasm.min.mjs' });
    expect(routeOf(['tts', 'piper', 'voices', 'en_US-amy-low.onnx.json'])).toEqual({ kind: 'asset', assetId: 'en_US-amy-low', assetPath: 'voices/en_US-amy-low.onnx.json' });
    expect(routeOf(['tts', 'piper', 'voices', 'en_US-amy-low.onnx'])).toMatchObject({ assetId: 'en_US-amy-low' });
    expect(routeOf(['tts', 'piper', 'voices', 'x.txt'])).toBeNull();
    expect(routeOf(['pronunciation', 'en', 'KJV.json'])).toEqual({ kind: 'asset', assetId: 'piper-pronunciation', assetPath: 'en/KJV.json' });
    expect(routeOf(['v1', 'index.json'])).toEqual({ kind: 'recording', rel: 'v1/index.json' });
    expect(routeOf(['nope', 'x'])).toBeNull();
  });
  it('parses ranges', () => {
    expect(parseRange('bytes=0-3', 10)).toEqual({ start: 0, end: 3 });
    expect(parseRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=5-99', 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,3-4', 10)).toBeNull();
    expect(parseRange(null, 10)).toBeNull();
  });
  it('rewrites the CommonJS tail to an ES export', () => {
    expect(toEsModule("var createPiperPhonemize = 1;\nif (typeof exports === 'object') {}\n")).toContain('export default createPiperPhonemize;');
    expect(() => toEsModule('nothing')).toThrow();
  });
});

describe('kth-audio handler', () => {
  const bytes = enc('0123456789');

  it('serves an installed asset with type, CORS and Range', async () => {
    const t = setup({ assets: { 'piper-runtime:runtime/x.wasm': '/store/x.wasm' }, files: { '/store/x.wasm': bytes } });
    const full = await t.get('tts/piper/runtime/x.wasm');
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('application/wasm');
    expect(full.headers.get('access-control-allow-origin')).toBe('*');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(await full.text()).toBe('0123456789');
    const part = await t.get('tts/piper/runtime/x.wasm', { headers: { Range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(part.headers.get('content-length')).toBe('3');
    expect(await part.text()).toBe('234');
    const bad = await t.get('tts/piper/runtime/x.wasm', { headers: { Range: 'bytes=20-' } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe('bytes */10');
    const head = await t.get('tts/piper/runtime/x.wasm', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('10');
    expect(await head.text()).toBe('');
  });

  it('404 for an asset that is not installed or unknown route', async () => {
    const t = setup();
    expect((await t.get('tts/piper/voices/en_US-amy-low.onnx')).status).toBe(404);
    expect((await t.get('pronunciation/en/KJV.json')).status).toBe(404);
    expect((await t.get('unknown/x')).status).toBe(404);
  });

  it('serves piper_phonemize.js as an ES module (cached, Range on the transformed text)', async () => {
    const src = "var createPiperPhonemize = 1;\nif (typeof exports === 'object') { module.exports = 1; }\n";
    const t = setup({ assets: { 'piper-runtime:runtime/piper_phonemize.js': '/s/p.js' }, files: { '/s/p.js': enc(src) } });
    const r = await t.get('tts/piper/runtime/piper_phonemize.js');
    expect(r.headers.get('content-type')).toBe('text/javascript');
    const body = await r.text();
    expect(body).toContain('export default createPiperPhonemize;');
    expect(body).not.toContain('module.exports');
    expect(r.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
    const part = await t.get('tts/piper/runtime/piper_phonemize.js', { headers: { Range: 'bytes=0-2' } });
    expect(await part.text()).toBe('var');
  });

  it('serves a downloaded recording before the network', async () => {
    const t = setup({ base: 'https://rec.test/audio', files: { '/dl/v1/kjv/a.ogg': bytes } });
    const r = await t.get('v1/kjv/a.ogg', { headers: { Range: 'bytes=0-1' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-type')).toBe('audio/ogg');
    expect(t.calls).toHaveLength(0);
  });

  it('proxies recordings through the gateway with Range passed on', async () => {
    const t = setup({
      base: 'https://rec.test/audio',
      upstream: async () => ({ status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-2/9', 'content-length': '3' }, body: new Uint8Array([1, 2, 3]) }),
    });
    const r = await t.get('v1/kjv/a.mp3', { headers: { Range: 'bytes=0-2' } });
    expect(t.calls).toEqual([{ url: 'https://rec.test/audio/v1/kjv/a.mp3', range: 'bytes=0-2' }]);
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 0-2/9');
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('upstream 404 stays 404, other errors become 502, offline becomes 503, no base 404', async () => {
    expect((await setup({ base: 'https://r.test', upstream: async () => ({ status: 404, headers: {}, body: null }) }).get('v1/x.json')).status).toBe(404);
    expect((await setup({ base: 'https://r.test', upstream: async () => ({ status: 500, headers: {}, body: null }) }).get('v1/x.json')).status).toBe(502);
    const offline = setup({ base: 'https://r.test', upstream: async () => { throw Object.assign(new Error('off'), { code: 'network_blocked' }); } });
    expect((await offline.get('v1/x.json')).status).toBe(503);
    expect((await setup({ base: 'https://r.test', upstream: async () => { throw new Error('boom'); } }).get('v1/x.json')).status).toBe(502);
    const none = setup({ base: null });
    expect((await none.get('v1/x.json')).status).toBe(404);
    expect(none.calls).toHaveLength(0);
  });

  it('refuses other methods, hosts, traversal', async () => {
    const t = setup({ base: 'https://r.test' });
    expect((await t.get('v1/x.json', { method: 'POST', body: 'x' })).status).toBe(405);
    expect((await t.get('v1/x.json', { host: 'evil' })).status).toBe(400);
    expect([400, 404]).toContain((await t.get('v1/%2e%2e/secret')).status); // the URL parser may already collapse it
    expect((await t.get('v1/.env')).status).toBe(400);
    expect(t.calls).toHaveLength(0);
  });
});
