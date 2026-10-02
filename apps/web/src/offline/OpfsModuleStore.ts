/**
 * Web `IAssetStore` for Bible/module databases over OPFS (task 0075).
 *
 * The server serves each module as one gzip file (`<abbr>.db.gz`; the sha256 is over the gz bytes).
 * The worker needs the plain SQLite file at `modules/<abbr>.db` (see bibleWorker.ts), so:
 *
 *   - a partial download lives at `modules/.partial/<assetId>.<version>` (gz bytes, flushed in ~4 MB
 *     pieces) next to `<assetId>.<version>.meta.json` (validator, size, mtime), so a reload resumes;
 *   - `commit()` streams the partial through `DecompressionStream('gzip')` into
 *     `modules/<abbr>.db.tmp`, checks the SQLite header, then moves it over `modules/<abbr>.db`
 *     (where `FileSystemFileHandle.move()` is missing: copy + remove);
 *   - `exists`/`delete` address the decompressed file, `read()` returns decompressed bytes.
 *
 * `AssetManager.adopt()` is NOT supported for modules: it re-hashes `read()` output, but the manifest
 * hash is over the gz, so adopt always reports false (and deletes the file). Legacy un-versioned files
 * stay on the legacy path (see OfflineStorageManager).
 *
 * Without `DecompressionStream` (Safari < 16.4, old Firefox) commit throws AssetError('storage');
 * the caller then falls back to the legacy download. fflate is not a dependency of the web app.
 *
 * The committed version of each file is recorded in `modules/.versions.json`, so the manager's upgrade
 * cleanup (which deletes the OLD version's ref after the new one is committed) cannot remove the new file.
 */

import { AssetError, isAssetError } from '@bible/core/browser';
import type { AssetFileRef, IAssetStore, IPartialFile } from '@bible/core/browser';

export const FLUSH_BYTES = 4 * 1024 * 1024;
const MODULES_DIR = 'modules';
const PARTIAL_DIR = '.partial';
const VERSIONS_FILE = '.versions.json';
const SQLITE_MAGIC = 'SQLite format 3\u0000';

type Dir = FileSystemDirectoryHandle;
type RootGetter = () => Promise<Dir>;

interface MoveCapable { move?: (...args: unknown[]) => Promise<void> }
interface EntriesCapable { entries(): AsyncIterable<[string, FileSystemHandle]> }

function toAssetError(e: unknown, what: string): AssetError {
  if (isAssetError(e)) return e as AssetError;
  const name = e && typeof e === 'object' ? (e as { name?: unknown }).name : undefined;
  if (name === 'QuotaExceededError') return new AssetError('quota', `Storage is full (${what})`);
  return new AssetError('storage', `${what}: ${e instanceof Error ? e.message : String(e)}`);
}

async function guard<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toAssetError(e, what);
  }
}

export function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

function isNotFound(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'NotFoundError';
}

/** `KJV.db.gz` -> `KJV.db`. Rejects anything that could leave the modules directory. */
export function finalName(path: string): string {
  if (!path || /[\\/]/.test(path) || path.startsWith('.') || path.includes('\0')) {
    throw new AssetError('storage', `Unsupported module file name: ${path}`);
  }
  return path.endsWith('.gz') ? path.slice(0, -3) : path;
}

function partialKey(ref: AssetFileRef): string {
  return `${ref.assetId}.${ref.version}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function subdir(root: Dir, name: string, create: boolean): Promise<Dir | null> {
  try {
    return await root.getDirectoryHandle(name, { create });
  } catch (e) {
    if (!create && isNotFound(e)) return null;
    throw e;
  }
}

async function tryGetFile(dir: Dir, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function tryRemove(dir: Dir, name: string): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

async function writeWhole(dir: Dir, name: string, data: string | Uint8Array): Promise<void> {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  try {
    await w.write(data as unknown as FileSystemWriteChunkType);
    await w.close();
  } catch (e) {
    try { await w.abort(); } catch { /* ignore */ }
    throw e;
  }
}

async function* readFile(file: File, chunk = 1024 * 1024): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < file.size; at += chunk) {
    yield new Uint8Array(await file.slice(at, Math.min(file.size, at + chunk)).arrayBuffer());
  }
}

interface PartialMeta { validator: string | null; size: number; touchedAt: number }

export class OpfsModuleStore implements IAssetStore {
  private versionsChain: Promise<void> = Promise.resolve();

  /** @throws AssetError('storage') when OPFS is unavailable and no `getRoot` is injected. */
  constructor(
    private readonly getRoot: RootGetter = defaultRoot(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async modulesDir(create: boolean): Promise<Dir | null> {
    const root = await guard('open OPFS', () => this.getRoot());
    return guard('open modules dir', () => subdir(root, MODULES_DIR, create));
  }

  private async partialDir(create: boolean): Promise<Dir | null> {
    const m = await this.modulesDir(create);
    if (!m) return null;
    return guard('open partial dir', () => subdir(m, PARTIAL_DIR, create));
  }

  async exists(ref: AssetFileRef): Promise<boolean> {
    const name = finalName(ref.path);
    return guard('exists', async () => {
      const m = await this.modulesDir(false);
      return !!m && (await tryGetFile(m, name)) !== null;
    });
  }

  async read(ref: AssetFileRef): Promise<AsyncIterable<Uint8Array> | null> {
    const name = finalName(ref.path);
    return guard('read', async () => {
      const m = await this.modulesDir(false);
      const file = m ? await tryGetFile(m, name) : null;
      return file ? readFile(file) : null;
    });
  }

  async openPartial(ref: AssetFileRef): Promise<IPartialFile> {
    const name = finalName(ref.path);
    return guard('openPartial', async () => {
      const m = (await this.modulesDir(true))!;
      const dir = (await this.partialDir(true))!;
      const p = new OpfsPartial(m, dir, partialKey(ref), ref, name, this.now, (n, v) => this.recordVersion(m, n, v));
      await p.load();
      return p;
    });
  }

  async delete(refs: AssetFileRef[]): Promise<void> {
    await guard('delete', async () => {
      const m = await this.modulesDir(false);
      if (!m) return;
      const dir = await this.partialDir(false);
      for (const ref of refs) {
        const name = finalName(ref.path);
        if (dir) {
          const key = partialKey(ref);
          await tryRemove(dir, key);
          await tryRemove(dir, `${key}.meta.json`);
        }
        const versions = await this.readVersions(m);
        const committed = versions[name];
        // A different version was committed since: this ref is stale and the file is newer than it.
        if (committed !== undefined && committed !== ref.version) continue;
        await tryRemove(m, name);
        await tryRemove(m, `${name}.tmp`);
        if (committed !== undefined) await this.recordVersion(m, name, null);
      }
    });
  }

  async sweepPartials(olderThanMs: number): Promise<void> {
    await guard('sweepPartials', async () => {
      const dir = await this.partialDir(false);
      if (!dir) return;
      const cutoff = this.now() - olderThanMs;
      const names: string[] = [];
      for await (const [name, handle] of (dir as unknown as EntriesCapable).entries()) {
        if (handle.kind === 'file') names.push(name);
      }
      for (const name of names) {
        const metaName = name.endsWith('.meta.json') ? name : `${name}.meta.json`;
        const key = metaName.slice(0, -'.meta.json'.length);
        const metaFile = await tryGetFile(dir, metaName);
        let touched = 0;
        if (metaFile) {
          try { touched = (JSON.parse(await metaFile.text()) as PartialMeta).touchedAt ?? 0; } catch { touched = 0; }
        }
        // No readable meta: an orphan left by a crash.
        if (!metaFile || touched <= cutoff) {
          await tryRemove(dir, key);
          await tryRemove(dir, metaName);
        }
      }
    });
  }

  async freeBytes(): Promise<number | null> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (!est || typeof est.quota !== 'number' || typeof est.usage !== 'number') return null;
      return Math.max(0, est.quota - est.usage);
    } catch {
      return null;
    }
  }

  private async readVersions(m: Dir): Promise<Record<string, string>> {
    try {
      const f = await tryGetFile(m, VERSIONS_FILE);
      if (!f) return {};
      const json = JSON.parse(await f.text()) as unknown;
      return json && typeof json === 'object' ? (json as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private recordVersion(m: Dir, name: string, version: string | null): Promise<void> {
    const run = async (): Promise<void> => {
      const v = await this.readVersions(m);
      if (version === null) delete v[name];
      else v[name] = version;
      await writeWhole(m, VERSIONS_FILE, JSON.stringify(v));
    };
    const next = this.versionsChain.then(run, run);
    this.versionsChain = next.catch(() => {});
    return next;
  }
}

function defaultRoot(): RootGetter {
  if (!opfsAvailable()) throw new AssetError('storage', 'The Origin Private File System is not available in this browser');
  return () => navigator.storage.getDirectory();
}

class OpfsPartial implements IPartialFile {
  private flushed = 0;
  private buffer: Uint8Array[] = [];
  private buffered = 0;
  private _validator: string | null = null;

  constructor(
    private readonly modules: Dir,
    private readonly dir: Dir,
    private readonly key: string,
    private readonly ref: AssetFileRef,
    private readonly finalFile: string,
    private readonly now: () => number,
    private readonly recordVersion: (name: string, version: string) => Promise<void>,
  ) {}

  get size(): number { return this.flushed + this.buffered; }
  get validator(): string | null { return this._validator; }

  private get metaName(): string { return `${this.key}.meta.json`; }

  async load(): Promise<void> {
    const metaFile = await tryGetFile(this.dir, this.metaName);
    const data = await tryGetFile(this.dir, this.key);
    let meta: PartialMeta | null = null;
    if (metaFile) {
      try {
        const m = JSON.parse(await metaFile.text()) as PartialMeta;
        if (m && typeof m.size === 'number') meta = { validator: typeof m.validator === 'string' ? m.validator : null, size: m.size, touchedAt: m.touchedAt ?? 0 };
      } catch { /* corrupt */ }
    }
    if (!meta || (meta.size > 0 && (!data || data.size < meta.size))) {
      await this.wipe();
      return;
    }
    if (data && data.size > meta.size) {
      // Bytes written after the last meta update: drop them.
      const h = await this.dir.getFileHandle(this.key);
      const w = await h.createWritable({ keepExistingData: true });
      await w.truncate(meta.size);
      await w.close();
    }
    this.flushed = meta.size;
    this._validator = meta.validator;
  }

  private async wipe(): Promise<void> {
    await tryRemove(this.dir, this.key);
    await tryRemove(this.dir, this.metaName);
    this.flushed = 0;
    this.buffer = [];
    this.buffered = 0;
  }

  private async writeMeta(): Promise<void> {
    const meta: PartialMeta = { validator: this._validator, size: this.flushed, touchedAt: this.now() };
    await writeWhole(this.dir, this.metaName, JSON.stringify(meta));
  }

  private async flush(): Promise<void> {
    if (this.buffered === 0) return;
    const h = await this.dir.getFileHandle(this.key, { create: true });
    const w = await h.createWritable({ keepExistingData: true });
    try {
      await w.seek(this.flushed);
      for (const c of this.buffer) await w.write(c as unknown as FileSystemWriteChunkType);
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch { /* ignore */ }
      throw e;
    }
    this.flushed += this.buffered;
    this.buffer = [];
    this.buffered = 0;
    await this.writeMeta();
  }

  async append(chunk: Uint8Array): Promise<void> {
    if (chunk.length === 0) return;
    this.buffer.push(chunk);
    this.buffered += chunk.length;
    if (this.buffered >= FLUSH_BYTES) await guard('append', () => this.flush());
  }

  async *read(): AsyncGenerator<Uint8Array> {
    if (this.flushed > 0) {
      const file = await guard('read partial', () => tryGetFile(this.dir, this.key));
      if (!file || file.size < this.flushed) throw new AssetError('storage', 'Partial download is missing');
      yield* readFile(file.slice(0, this.flushed) as File);
    }
    for (const c of [...this.buffer]) yield c;
  }

  async reset(validator: string | null): Promise<void> {
    await guard('reset', async () => {
      await this.wipe();
      this._validator = validator;
      await this.writeMeta();
    });
  }

  async close(): Promise<void> {
    await guard('close', async () => {
      await this.flush();
      if (this.flushed > 0 || this._validator !== null) await this.writeMeta();
    });
  }

  async commit(): Promise<void> {
    await guard('commit', async () => {
      await this.flush();
      if (typeof DecompressionStream === 'undefined') {
        throw new AssetError('storage', 'This browser cannot decompress module downloads (no DecompressionStream)');
      }
      const tmpName = `${this.finalFile}.tmp`;
      const src = await tryGetFile(this.dir, this.key);
      if (!src) throw new AssetError('storage', 'Partial download is missing');
      const tmpHandle = await this.modules.getFileHandle(tmpName, { create: true });
      const out = await tmpHandle.createWritable();
      try {
        await gunzipInto(src, out);
        await out.close();
      } catch (e) {
        try { await out.abort(); } catch { /* ignore */ }
        await tryRemove(this.modules, tmpName).catch(() => {});
        throw e;
      }
      const tmpFile = await tmpHandle.getFile();
      const head = new TextDecoder('latin1').decode(new Uint8Array(await tmpFile.slice(0, SQLITE_MAGIC.length).arrayBuffer()));
      if (head !== SQLITE_MAGIC) {
        await tryRemove(this.modules, tmpName).catch(() => {});
        throw new AssetError('storage', 'The downloaded module is not a SQLite database');
      }
      await moveOver(this.modules, tmpHandle, tmpName, this.finalFile);
      await this.recordVersion(this.finalFile, this.ref.version);
      await this.wipe();
    });
  }

  async discard(): Promise<void> {
    await guard('discard', async () => {
      await this.wipe();
      this._validator = null;
    });
  }
}

/** Gunzip `src` into `out`; the first 16 bytes checked by the caller, so just pump. */
async function gunzipInto(src: File, out: FileSystemWritableFileStream): Promise<void> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && value.length) await out.write(value as unknown as FileSystemWriteChunkType);
    }
  })();
  pump.catch(() => {});
  try {
    for await (const c of readFile(src)) await writer.write(c as unknown as BufferSource);
    await writer.close();
  } catch (e) {
    try { await writer.abort(e); } catch { /* ignore */ }
    try { await pump; } catch { /* the feed error wins */ }
    throw e;
  }
  try {
    await pump;
  } catch (e) {
    throw new AssetError('storage', `The downloaded module is not valid gzip: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function moveOver(dir: Dir, handle: FileSystemFileHandle, tmpName: string, finalFile: string): Promise<void> {
  const movable = handle as unknown as MoveCapable;
  if (typeof movable.move === 'function') {
    try {
      await (movable.move as (d: Dir, n: string) => Promise<void>).call(handle, dir, finalFile);
      return;
    } catch {
      /* fall through to copy */
    }
  }
  const tmp = await handle.getFile();
  const dst = await dir.getFileHandle(finalFile, { create: true });
  const w = await dst.createWritable();
  try {
    for await (const c of readFile(tmp)) await w.write(c as unknown as FileSystemWriteChunkType);
    await w.close();
  } catch (e) {
    try { await w.abort(); } catch { /* ignore */ }
    throw e;
  }
  await tryRemove(dir, tmpName);
}
