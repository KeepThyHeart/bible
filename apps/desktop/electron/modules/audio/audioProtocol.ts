/**
 * `kth-audio://app/audio/...` request handling (task 0223). Pure of Electron: every dependency is
 * injected, so routing, Range, traversal and offline behaviour are unit-testable.
 *
 * Routes (the path after `/audio/`):
 *   tts/piper/runtime/<file>            asset `piper-runtime`, file `runtime/<file>`
 *   tts/piper/voices/<id>.onnx[.json]   asset `<id>`, file `voices/<id>.onnx[.json]`
 *   pronunciation/<path>                asset `piper-pronunciation`, file `<path>`
 *   v1/<...>                            recordings: a downloaded copy first, else the recordings base through the gateway
 * Never logs what is requested (what a person listens to is private).
 */
import { AUDIO_BASE_URL, AUDIO_SCHEME, PIPER_PRONUNCIATION_ASSET_ID, PIPER_RUNTIME_ASSET_ID } from './types';

const PREFIX = '/audio/';

export type Route =
  | { kind: 'asset'; assetId: string; assetPath: string }
  | { kind: 'recording'; rel: string };

/** Reduce a request pathname to safe segments, or null when it must be refused. */
export function safeSegments(pathname: string): string[] | null {
  if (!pathname.startsWith(PREFIX)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname.slice(PREFIX.length));
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return null;
  const segs = decoded.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..' || s.startsWith('.') || /[:?#%*<>|"\u0000-\u001f\u007f]/.test(s)) return null;
  }
  return segs;
}

export function routeOf(segs: readonly string[]): Route | null {
  if (segs[0] === 'v1' && segs.length >= 2) return { kind: 'recording', rel: segs.join('/') };
  if (segs[0] === 'pronunciation' && segs.length >= 2) {
    return { kind: 'asset', assetId: PIPER_PRONUNCIATION_ASSET_ID, assetPath: segs.slice(1).join('/') };
  }
  if (segs[0] === 'tts' && segs[1] === 'piper' && segs.length === 4) {
    const file = segs[3]!;
    if (segs[2] === 'runtime') return { kind: 'asset', assetId: PIPER_RUNTIME_ASSET_ID, assetPath: `runtime/${file}` };
    if (segs[2] === 'voices') {
      const id = file.endsWith('.onnx.json') ? file.slice(0, -'.onnx.json'.length) : file.endsWith('.onnx') ? file.slice(0, -'.onnx'.length) : '';
      if (id) return { kind: 'asset', assetId: id, assetPath: `voices/${file}` };
    }
  }
  return null;
}

const TYPES: Record<string, string> = {
  mjs: 'text/javascript', js: 'text/javascript', wasm: 'application/wasm', json: 'application/json',
  onnx: 'application/octet-stream', data: 'application/octet-stream',
  ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
};

export function contentTypeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return TYPES[ext] ?? 'application/octet-stream';
}

/** Recordings (`v1/`) are data only: anything that would be a script or wasm is served as bytes. */
export function recordingTypeOf(name: string): string {
  const type = contentTypeOf(name);
  return /javascript|wasm|html/.test(type) ? 'application/octet-stream' : type;
}

/** Parse a single-range `Range` header against `size`. `null` = ignore the header; `'unsatisfiable'` = 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (m[2] !== '' && Number(m[2]) < start) return null;
  }
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

/** ES-module form of piper_phonemize.js (port of `toEsModule` in apps/web/scripts/fetch-piper-assets.mjs). */
export function toEsModule(source: string): string {
  const tail = source.lastIndexOf("if (typeof exports === 'object'");
  if (tail < 0) throw new Error('piper_phonemize.js has an unexpected shape (no CommonJS tail)');
  return `${source.slice(0, tail)}\nexport default createPiperPhonemize;\n`;
}

export interface UpstreamResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  body: BodyInit | null;
}

export interface AudioProtocolDeps {
  /** Absolute path of an installed asset file, or null. */
  resolveAsset(assetId: string, assetPath: string): Promise<string | null>;
  /** `<userData>/audio-downloads`; recordings live under its `v1/`. */
  downloadsRoot(): string;
  /** The configured recordings base (http/https, no trailing slash) or null. */
  recordingsBase(): string | null;
  /** GET through the gateway; throws an error with `code: 'network_blocked'` when offline. */
  fetchUpstream(url: string, range: string | null): Promise<UpstreamResponse>;
  /** Size of a regular file, or null when absent / not a file. */
  statFile(path: string): Promise<number | null>;
  /** Bytes `start..end` (inclusive) of a file as a body. */
  openFile(path: string, start: number, end: number): BodyInit;
  readText(path: string): Promise<string>;
  joinPath(root: string, ...parts: string[]): string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  'X-Content-Type-Options': 'nosniff',
};

const text = (status: number, msg: string, extra: Record<string, string> = {}): Response =>
  new Response(msg, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', ...extra } });

export function createAudioHandler(deps: AudioProtocolDeps): (request: Request) => Promise<Response> {
  const esCache = new Map<string, { size: number; buf: Buffer }>();

  async function serveLocal(request: Request, path: string, name: string, size: number, typeOf: (n: string) => string = contentTypeOf): Promise<Response> {
    const isTransformed = name === 'piper_phonemize.js';
    let total = size;
    let open: (s: number, e: number) => BodyInit = (s, e) => deps.openFile(path, s, e);
    if (isTransformed) {
      let hit = esCache.get(path);
      if (!hit || hit.size !== size) {
        hit = { size, buf: Buffer.from(toEsModule(await deps.readText(path)), 'utf8') };
        esCache.set(path, hit);
      }
      const buf = hit.buf;
      total = buf.length;
      open = (s, e) => new Uint8Array(buf.subarray(s, e + 1));
    }
    const headers: Record<string, string> = { ...CORS, 'Content-Type': typeOf(name), 'Accept-Ranges': 'bytes' };
    const range = parseRange(request.headers.get('range'), total);
    if (range === 'unsatisfiable') return text(416, 'Range not satisfiable', { 'Content-Range': `bytes */${total}` });
    const head = request.method === 'HEAD';
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total}`;
      headers['Content-Length'] = String(range.end - range.start + 1);
      return new Response(head ? null : open(range.start, range.end), { status: 206, headers });
    }
    headers['Content-Length'] = String(total);
    if (head || total === 0) return new Response(null, { status: 200, headers });
    return new Response(open(0, total - 1), { status: 200, headers });
  }

  async function serveFile(request: Request, path: string, name: string, typeOf?: (n: string) => string): Promise<Response | null> {
    const size = await deps.statFile(path);
    return size === null ? null : serveLocal(request, path, name, size, typeOf);
  }

  async function proxy(request: Request, rel: string): Promise<Response> {
    const base = deps.recordingsBase();
    if (!base) return text(404, 'Not found');
    let up: UpstreamResponse;
    try {
      up = await deps.fetchUpstream(`${base}/${rel.split('/').map(encodeURIComponent).join('/')}`, request.headers.get('range'));
    } catch (e) {
      if ((e as { code?: string }).code === 'network_blocked') return text(503, 'Web requests are turned off');
      return text(502, 'Upstream unavailable');
    }
    if (![200, 206, 404, 416].includes(up.status)) return text(up.status >= 500 ? 502 : 404, 'Not found');
    const headers: Record<string, string> = { ...CORS, // The type comes from the file name, never from upstream: nothing proxied may become a script.
      'Content-Type': recordingTypeOf(rel), 'Accept-Ranges': up.headers['accept-ranges'] ?? 'bytes' };
    if (up.headers['content-length']) headers['Content-Length'] = up.headers['content-length']!;
    if (up.headers['content-range']) headers['Content-Range'] = up.headers['content-range']!;
    const body = request.method === 'HEAD' || up.status === 404 || up.status === 416 ? null : up.body;
    return new Response(body, { status: up.status, headers });
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return text(400, 'Bad request');
    }
    if (url.protocol !== `${AUDIO_SCHEME}:` || url.hostname.toLowerCase() !== 'app') return text(400, 'Bad request');
    const segs = safeSegments(url.pathname);
    if (!segs) return text(400, 'Bad request');
    const route = routeOf(segs);
    if (!route) return text(404, 'Not found');
    const name = segs[segs.length - 1]!;
    try {
      if (route.kind === 'asset') {
        const path = await deps.resolveAsset(route.assetId, route.assetPath);
        return (path && (await serveFile(request, path, name))) || text(404, 'Not found');
      }
      const local = await serveFile(request, deps.joinPath(deps.downloadsRoot(), ...segs), name, recordingTypeOf);
      return local ?? (await proxy(request, route.rel));
    } catch {
      return text(500, 'Internal error');
    }
  };
}

export { AUDIO_BASE_URL };
