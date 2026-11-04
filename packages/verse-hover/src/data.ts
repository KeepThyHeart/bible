import type { ChapterSlice, Manifest, SliceRequest, SourceConfig } from './types';

const MAX_URL = 1800;
const CACHE = 64;

export interface DataClient {
  get(req: SliceRequest): Promise<ChapterSlice>;
  manifest(tr: string): Promise<Manifest | null>;
  /** Fire-and-forget warm-up. */
  prefetch(req: SliceRequest): void;
}

/** Decodes a response body: gzip bytes (magic 1f 8b) are inflated, anything else is parsed as it is. */
export async function decode(res: Response): Promise<unknown> {
  const buf = new Uint8Array(await res.arrayBuffer());
  let bytes = buf;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    bytes = new Uint8Array(await new Response(new Response(buf).body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

const getJson = (url: string): Promise<any> =>
  fetch(url, { credentials: 'omit', mode: 'cors' }).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return decode(r);
  });

/** verse id: book*1e6 + chapter*1e3 + verse */
export const vid = (b: number, c: number, v: number) => b * 1e6 + c * 1e3 + v;

export function createData(src: () => SourceConfig, scriptBase: () => string): DataClient {
  const cache = new Map<string, Promise<any>>();
  const remember = <T>(key: string, make: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key); // refresh LRU order
      cache.set(key, hit);
      return hit;
    }
    const p = make();
    p.catch(() => cache.delete(key)); // failures are retried next time
    cache.set(key, p);
    if (cache.size > CACHE) cache.delete(cache.keys().next().value as string);
    return p;
  };

  // php: coalesce requests that arrive within 30 ms into one call.
  type Pending = { req: SliceRequest; ok: (s: ChapterSlice) => void; fail: (e: unknown) => void };
  let queue: Pending[] = [];
  let timer = 0;
  const phpUrl = (u: string) => new URL(u, scriptBase()).href;

  function flush() {
    timer = 0;
    const batch = queue;
    queue = [];
    const byTr = new Map<string, Pending[]>();
    for (const p of batch) (byTr.get(p.req.tr) || byTr.set(p.req.tr, []).get(p.req.tr)!).push(p);
    const s = src();
    if (s.type !== 'php') return;
    for (const [tr, list] of byTr) {
      const head = `${phpUrl(s.url)}${s.url.includes('?') ? '&' : '?'}t=${encodeURIComponent(tr)}&r=`;
      let group: Pending[] = [];
      let ids = '';
      const send = () => {
        if (!group.length) return;
        const g = group;
        group = [];
        const url = head + ids;
        ids = '';
        getJson(url).then(
          (j) =>
            g.forEach((p) => {
              const k = p.req.book * 1000 + p.req.chapter;
              const hit = (j.s || []).find((x: ChapterSlice) => x.k === k && p.req.from >= x.f && p.req.from < x.f + Math.max(1, x.v.length)) || (j.s || []).find((x: ChapterSlice) => x.k === k);
              if (hit) p.ok(hit); else p.fail(new Error('empty'));
            }),
          (e) => g.forEach((p) => p.fail(e)),
        );
      };
      for (const p of list) {
        const r = p.req;
        const part = `${vid(r.book, r.chapter, r.from)}-${vid(r.book, r.chapter, r.to)}`;
        if (head.length + ids.length + part.length + 1 > MAX_URL) send();
        ids += (ids ? ',' : '') + part;
        group.push(p);
      }
      send();
    }
  }

  function get(req: SliceRequest): Promise<ChapterSlice> {
    const s = src();
    if (s.type === 'custom') return remember(`c:${req.tr}:${req.book}:${req.chapter}:${req.from}:${req.to}`, () => s.load(req));
    if (s.type === 'static') {
      const url = `${new URL(s.base, scriptBase()).href.replace(/\/?$/, '/')}${req.tr}/${req.book}/${req.chapter}.json${s.compressed === 'gzip' ? '.gz' : ''}`;
      return remember(url, () => getJson(url));
    }
    return remember(`p:${req.tr}:${req.book}:${req.chapter}:${req.from}:${req.to}`, () =>
      new Promise<ChapterSlice>((ok, fail) => {
        queue.push({ req, ok, fail });
        if (!timer) timer = window.setTimeout(flush, 30);
      }),
    );
  }

  function manifest(tr: string): Promise<Manifest | null> {
    const s = src();
    let url: string;
    if (s.type === 'static') url = `${new URL(s.base, scriptBase()).href.replace(/\/?$/, '/')}${tr}/manifest.json`;
    else if (s.type === 'php') url = `${phpUrl(s.url)}${s.url.includes('?') ? '&' : '?'}t=${encodeURIComponent(tr)}&m=1`;
    else return Promise.resolve(null);
    return remember(url, () => getJson(url)).catch(() => null);
  }

  return { get, manifest, prefetch: (r) => void get(r).catch(() => 0) };
}
