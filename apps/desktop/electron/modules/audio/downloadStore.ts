/**
 * Per-book audio downloads, main-process side (task 0223, Phase 5). Pure of Electron: the upstream
 * fetch, the recordings base, the downloads root and the free-space probe are injected.
 *
 * A URL the player uses (`kth-audio://app/audio/v1/<rest>`) maps to `<downloads root>/v1/<rest>`;
 * the bytes come from `<recordings base>/v1/<rest>` through the gateway, are written to `<file>.part`,
 * verified (size, sha256) and only then renamed, so a cut-off download never looks complete.
 * Never logs which books or chapters are downloaded.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, rmdir, stat, statfs, open } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { AUDIO_BASE_URL } from './types';
import type { UpstreamResponse } from './audioProtocol';

export interface DownloadFile { url: string; bytes: number; sha256?: string }
export interface DownloadProgress {
  state: 'running' | 'done' | 'failed' | 'cancelled';
  loaded: number;
  error?: string;
  code?: string;
}

export interface DownloadStoreDeps {
  downloadsRoot(): string;
  recordingsBase(): string | null;
  /** GET through the gateway; rejects with `code: 'network_blocked'` when offline. */
  fetchUpstream(url: string, range: string | null): Promise<UpstreamResponse>;
  /** Free bytes on the volume holding `dir` (exists), or null. */
  freeBytesOf?(dir: string): Promise<number | null>;
}

const V1 = `${AUDIO_BASE_URL}/v1/`;

class DownloadError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

/** `kth-audio://app/audio/v1/<rest>` to its safe segments (`['v1', ...]`), or null. */
export function downloadSegments(url: string): string[] | null {
  if (typeof url !== 'string' || !url.startsWith(V1) || url.includes('\\') || url.includes('?') || url.includes('#')) return null;
  let rest: string;
  try { rest = decodeURIComponent(url.slice(V1.length)); } catch { return null; }
  if (!rest || rest.includes('\0') || rest.includes('\\')) return null;
  const segs = rest.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..' || s.startsWith('.') || /[:?#%*<>|"\u0000-\u001f\u007f]/.test(s)) return null;
  }
  return ['v1', ...segs];
}

async function sizeOf(p: string): Promise<number | null> {
  try { const s = await stat(p); return s.isFile() ? s.size : null; } catch { return null; }
}

interface Job { state: DownloadProgress['state']; loaded: number; error?: string; code?: string; abort: AbortController }

export function createDownloadStore(deps: DownloadStoreDeps) {
  const jobs = new Map<string, Job>();
  const pathOf = (segs: string[]): string => join(deps.downloadsRoot(), ...segs);

  async function present(urls: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const url of urls) {
      const segs = downloadSegments(url);
      if (segs && (await sizeOf(pathOf(segs))) !== null) out.push(url);
    }
    return out;
  }

  async function fetchOne(job: Job, file: DownloadFile, segs: string[], base: string): Promise<void> {
    const dest = pathOf(segs);
    const existing = await sizeOf(dest);
    // `index.json` is the one mutable file (a new narrator or revision): fetched again every run.
    const mutable = segs[segs.length - 1] === 'index.json';
    if (existing !== null && !mutable && (file.bytes <= 0 || existing === file.bytes)) {
      job.loaded += existing;
      return;
    }
    await mkdir(dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    let up: UpstreamResponse;
    try {
      up = await deps.fetchUpstream(`${base}/${segs.map(encodeURIComponent).join('/')}`, null);
    } catch (e) {
      if ((e as { code?: string }).code === 'network_blocked') throw new DownloadError('Web requests are turned off', 'offline');
      throw new DownloadError('Could not reach the recordings server', 'network');
    }
    if (up.status !== 200 || !up.body) {
      try { await (up.body as ReadableStream | null)?.cancel(); } catch { /* ignore */ }
      throw new DownloadError(up.status === 404 ? 'Recording not found' : 'Recordings server error', up.status === 404 ? 'not_found' : 'network');
    }
    const reader = (up.body as ReadableStream<Uint8Array>).getReader();
    const fh = await open(part, 'w');
    const hash = createHash('sha256');
    let written = 0;
    let closed = false;
    const cleanup = async (): Promise<void> => {
      if (!closed) { closed = true; try { await fh.close(); } catch { /* ignore */ } }
      await rm(part, { force: true });
    };
    const onAbort = (): void => { void reader.cancel().catch(() => undefined); };
    job.abort.signal.addEventListener('abort', onAbort);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (job.abort.signal.aborted) throw new DownloadError('Cancelled', 'cancelled');
        if (done) break;
        await fh.write(value);
        hash.update(value);
        written += value.byteLength;
        job.loaded += value.byteLength;
      }
      await fh.close();
      closed = true;
      if (file.bytes > 0 && written !== file.bytes) throw new DownloadError('Downloaded file has the wrong size', 'size');
      if (file.sha256 && hash.digest('hex') !== file.sha256.toLowerCase()) throw new DownloadError('Downloaded file is corrupt', 'checksum');
      await rename(part, dest);
    } catch (e) {
      job.loaded -= written;
      await cleanup();
      if (job.abort.signal.aborted) throw new DownloadError('Cancelled', 'cancelled');
      if (e instanceof DownloadError) throw e;
      throw new DownloadError('Download interrupted', 'network');
    } finally {
      job.abort.signal.removeEventListener('abort', onAbort);
    }
  }

  async function run(job: Job, files: DownloadFile[]): Promise<void> {
    try {
      const base = deps.recordingsBase();
      if (!base) throw new DownloadError('No recordings server is configured', 'no_source');
      for (const file of files) {
        if (job.abort.signal.aborted) throw new DownloadError('Cancelled', 'cancelled');
        const segs = downloadSegments(file.url);
        if (!segs) throw new DownloadError('Not a downloadable audio URL', 'bad_url');
        await fetchOne(job, file, segs, base);
      }
      job.state = 'done';
    } catch (e) {
      if (job.abort.signal.aborted || (e as { code?: string }).code === 'cancelled') {
        job.state = 'cancelled';
      } else {
        job.state = 'failed';
        job.error = e instanceof Error ? e.message : 'Download failed';
        job.code = (e as { code?: string }).code ?? 'unknown';
      }
    }
  }

  async function fetchFiles(files: DownloadFile[]): Promise<{ jobId: string }> {
    if (!Array.isArray(files)) throw new Error('files must be an array');
    for (const f of files) {
      if (!f || typeof f.url !== 'string' || !Number.isFinite(f.bytes) || f.bytes < 0) throw new Error('Invalid download entry');
      if (f.sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(f.sha256)) throw new Error('Invalid sha256');
    }
    const jobId = randomUUID();
    const job: Job = { state: 'running', loaded: 0, abort: new AbortController() };
    jobs.set(jobId, job);
    // A finished job is normally forgotten when the renderer reads it; one nobody reads (the window
    // went away) is dropped a minute later so jobs cannot pile up.
    void run(job, files).finally(() => {
      const t = setTimeout(() => jobs.delete(jobId), 60_000);
      (t as { unref?: () => void }).unref?.();
    });
    return { jobId };
  }

  async function progress(jobId: string): Promise<DownloadProgress> {
    const job = jobs.get(jobId);
    if (!job) return { state: 'failed', loaded: 0, error: 'Unknown download', code: 'unknown_job' };
    const out: DownloadProgress = { state: job.state, loaded: job.loaded };
    if (job.error) out.error = job.error;
    if (job.code) out.code = job.code;
    if (job.state !== 'running') jobs.delete(jobId);
    return out;
  }

  async function cancel(jobId: string): Promise<void> {
    jobs.get(jobId)?.abort.abort();
  }

  async function remove(urls: string[]): Promise<void> {
    const root = deps.downloadsRoot();
    for (const url of urls) {
      const segs = downloadSegments(url);
      if (!segs) continue;
      const p = pathOf(segs);
      await rm(p, { force: true });
      await rm(`${p}.part`, { force: true });
      let dir = dirname(p);
      while (dir.length > root.length && dir.startsWith(root + sep)) {
        try { await rmdir(dir); } catch { break; } // not empty (or gone)
        dir = dirname(dir);
      }
    }
  }

  async function freeBytes(): Promise<number | null> {
    try {
      const root = deps.downloadsRoot();
      await mkdir(root, { recursive: true });
      if (deps.freeBytesOf) return await deps.freeBytesOf(root);
      const s = await statfs(root);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  }

  async function usage(): Promise<{ bytes: number; files: number }> {
    let bytes = 0;
    let files = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && !e.name.endsWith('.part')) {
          const s = await sizeOf(p);
          if (s !== null) { bytes += s; files += 1; }
        }
      }
    };
    await walk(join(deps.downloadsRoot(), 'v1'));
    return { bytes, files };
  }

  return { present, fetchFiles, progress, cancel, remove, freeBytes, usage };
}

export type DownloadStore = ReturnType<typeof createDownloadStore>;
