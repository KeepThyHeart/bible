/**
 * Desktop asset store (task 0090): files under `<root>/files/<kind>/<id>/<version>/<path>`,
 * resumable partials under `<root>/partial/<kind>/<id>/<version>/<path>.part` (+ `.part.json`
 * `{ validator, touchedAt }`). Every resolved path is checked to stay inside its base directory.
 *
 * Commit = fsync + mkdir -p + rename (same volume). ENOSPC is reported as `quota`.
 */

import { promises as fsp } from 'fs';
import type { FileHandle } from 'fs/promises';
import { createHash } from 'crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import {
  AssetError,
  type AssetFileRef,
  type AssetRegistrySnapshot,
  type IAssetRegistryStore,
  type IAssetStore,
  type IHasher,
  type IPartialFile,
} from '@bible/core/browser';

const READ_CHUNK = 256 * 1024;
const PART_SUFFIX = '.part';
const META_SUFFIX = '.part.json';

/** Wrap node:crypto as the manager's incremental hasher. */
export function createNodeHasher(): IHasher {
  const h = createHash('sha256');
  return {
    update: (chunk) => { h.update(chunk); },
    digestHex: () => h.digest('hex'),
  };
}

function toAssetError(e: unknown, what: string): AssetError {
  if (e instanceof AssetError) return e;
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOSPC' || code === 'EDQUOT') return new AssetError('quota', `No space left while ${what}`);
  const msg = e instanceof Error ? e.message : String(e);
  return new AssetError('storage', `${what}: ${msg}`);
}

function isMissing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function* readFileChunks(file: string, limit?: number): AsyncGenerator<Uint8Array> {
  const fh = await fsp.open(file, 'r');
  try {
    let left = limit ?? Infinity;
    while (left > 0) {
      const buf = Buffer.allocUnsafe(Math.min(READ_CHUNK, left === Infinity ? READ_CHUNK : left));
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      left -= bytesRead;
      yield bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
    }
  } finally {
    await fh.close();
  }
}

class FsPartialFile implements IPartialFile {
  private handle: FileHandle | null = null;
  private ended = false;
  private _size: number;
  private _validator: string | null;

  constructor(
    private readonly partPath: string,
    private readonly metaPath: string,
    private readonly onEnd: (dir: string) => Promise<void>,
    size: number,
    validator: string | null,
  ) {
    this._size = size;
    this._validator = validator;
  }

  get size(): number { return this._size; }
  get validator(): string | null { return this._validator; }

  private async open(): Promise<FileHandle> {
    if (!this.handle) {
      await fsp.mkdir(dirname(this.partPath), { recursive: true });
      this.handle = await fsp.open(this.partPath, 'a');
    }
    return this.handle;
  }

  private async closeHandle(): Promise<void> {
    const h = this.handle;
    this.handle = null;
    if (h) await h.close();
  }

  private async writeMeta(): Promise<void> {
    await fsp.mkdir(dirname(this.metaPath), { recursive: true });
    await fsp.writeFile(this.metaPath, JSON.stringify({ validator: this._validator, touchedAt: Date.now() }));
  }

  read(): AsyncIterable<Uint8Array> {
    const size = this._size;
    const partPath = this.partPath;
    return (async function* () {
      if (size === 0) return;
      yield* readFileChunks(partPath, size);
    })();
  }

  async append(chunk: Uint8Array): Promise<void> {
    if (chunk.length === 0) return;
    try {
      const h = await this.open();
      await h.appendFile(chunk);
      this._size += chunk.length;
    } catch (e) {
      throw toAssetError(e, 'writing a download');
    }
  }

  async reset(validator: string | null): Promise<void> {
    try {
      await this.closeHandle();
      await fsp.mkdir(dirname(this.partPath), { recursive: true });
      await fsp.writeFile(this.partPath, '');
      this._size = 0;
      this._validator = validator;
      await this.writeMeta();
    } catch (e) {
      throw toAssetError(e, 'restarting a download');
    }
  }

  async close(): Promise<void> {
    if (this.ended) return;
    try {
      await this.closeHandle();
      if (this._size > 0 || this._validator !== null) await this.writeMeta();
    } catch (e) {
      throw toAssetError(e, 'saving a download');
    }
  }

  /** Overridden by the store: needs the destination path. */
  async commitTo(dest: string): Promise<void> {
    if (this.ended) throw new AssetError('storage', 'partial already ended');
    try {
      const h = await this.open();
      await h.sync();
      await this.closeHandle();
      await fsp.mkdir(dirname(dest), { recursive: true });
      await fsp.rename(this.partPath, dest);
      this.ended = true;
      await fsp.rm(this.metaPath, { force: true });
    } catch (e) {
      throw toAssetError(e, 'committing a file');
    }
    await this.onEnd(dirname(this.partPath));
  }

  commit(): Promise<void> {
    return Promise.reject(new AssetError('storage', 'commit() is bound by FsAssetStore'));
  }

  async discard(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    try {
      await this.closeHandle();
    } catch { /* discarding anyway */ }
    await fsp.rm(this.partPath, { force: true });
    await fsp.rm(this.metaPath, { force: true });
    await this.onEnd(dirname(this.partPath));
  }
}

export class FsAssetStore implements IAssetStore {
  private readonly root: string;
  private readonly filesBase: string;
  private readonly partialBase: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.filesBase = join(this.root, 'files');
    this.partialBase = join(this.root, 'partial');
  }

  /** Path of the registry document beside the store. */
  get registryPath(): string {
    return join(this.root, 'registry.json');
  }

  private contained(base: string, ref: AssetFileRef, suffix = ''): string {
    const segments = [ref.kind, ref.assetId, ref.version, ...ref.path.split('/')];
    for (const s of segments) {
      if (!s || s === '.' || s === '..' || s.includes('\\') || s.includes('\0') || s.includes(':')) {
        throw new AssetError('storage', `Refusing unsafe asset path: ${ref.assetId}/${ref.path}`);
      }
    }
    const target = resolve(base, ...segments) + suffix;
    const rel = relative(base, target);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new AssetError('storage', `Refusing to use a path outside the asset store: ${ref.assetId}/${ref.path}`);
    }
    return target;
  }

  /** Absolute path of a committed file (for main-process consumers); not checked for existence. */
  pathOf(ref: AssetFileRef): string {
    return this.contained(this.filesBase, ref);
  }

  async exists(ref: AssetFileRef): Promise<boolean> {
    try {
      return (await fsp.stat(this.pathOf(ref))).isFile();
    } catch (e) {
      if (isMissing(e)) return false;
      throw toAssetError(e, 'checking a file');
    }
  }

  async read(ref: AssetFileRef): Promise<AsyncIterable<Uint8Array> | null> {
    const file = this.pathOf(ref);
    try {
      if (!(await fsp.stat(file)).isFile()) return null;
    } catch (e) {
      if (isMissing(e)) return null;
      throw toAssetError(e, 'reading a file');
    }
    return readFileChunks(file);
  }

  async openPartial(ref: AssetFileRef): Promise<IPartialFile> {
    const partPath = this.contained(this.partialBase, ref, PART_SUFFIX);
    const metaPath = this.contained(this.partialBase, ref, META_SUFFIX);
    const dest = this.pathOf(ref);
    let size = 0;
    let validator: string | null = null;
    try {
      await fsp.mkdir(dirname(partPath), { recursive: true });
      try {
        size = (await fsp.stat(partPath)).size;
      } catch (e) {
        if (!isMissing(e)) throw e;
      }
      if (size > 0) {
        try {
          const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')) as { validator?: unknown };
          if (typeof meta.validator === 'string') validator = meta.validator;
        } catch { /* no usable meta: resume without a validator */ }
      }
    } catch (e) {
      throw toAssetError(e, 'opening a download');
    }
    const partial = new FsPartialFile(partPath, metaPath, (dir) => this.prune(this.partialBase, dir), size, validator);
    partial.commit = () => partial.commitTo(dest).then(() => this.prune(this.filesBase, dirname(dest)));
    return partial;
  }

  async delete(refs: AssetFileRef[]): Promise<void> {
    for (const ref of refs) {
      try {
        const file = this.pathOf(ref);
        const part = this.contained(this.partialBase, ref, PART_SUFFIX);
        const meta = this.contained(this.partialBase, ref, META_SUFFIX);
        await fsp.rm(file, { force: true });
        await fsp.rm(part, { force: true });
        await fsp.rm(meta, { force: true });
        await this.prune(this.filesBase, dirname(file));
        await this.prune(this.partialBase, dirname(part));
      } catch (e) {
        throw toAssetError(e, 'deleting a file');
      }
    }
  }

  async sweepPartials(olderThanMs: number): Promise<void> {
    const cutoff = Date.now() - olderThanMs;
    const walk = async (dir: string): Promise<void> => {
      let entries: import('fs').Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
          await this.prune(this.partialBase, full);
        } else if (e.name.endsWith(PART_SUFFIX) && !e.name.endsWith(META_SUFFIX)) {
          const meta = full.slice(0, -PART_SUFFIX.length) + META_SUFFIX;
          let touched = 0;
          try {
            touched = Number((JSON.parse(await fsp.readFile(meta, 'utf8')) as { touchedAt?: unknown }).touchedAt) || 0;
          } catch { /* fall back to mtime */ }
          if (!touched) {
            try { touched = (await fsp.stat(full)).mtimeMs; } catch { continue; }
          }
          if (touched < cutoff) {
            await fsp.rm(full, { force: true });
            await fsp.rm(meta, { force: true });
          }
        }
      }
    };
    await walk(this.partialBase);
  }

  async freeBytes(): Promise<number | null> {
    try {
      await fsp.mkdir(this.root, { recursive: true });
      const s = await fsp.statfs(this.root);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  }

  /**
   * Delete committed version directories that are not the installed version of their asset.
   * The manager's upgrade cleanup keys by url, so a file whose url is unchanged between versions
   * is kept in the OLD version directory (desktop keys by version); this reclaims it.
   * Assets not in `installed` are left alone (crash recovery may still reuse their files).
   */
  async pruneOtherVersions(installed: ReadonlyArray<{ kind: string; id: string; version: string }>): Promise<void> {
    for (const a of installed) {
      const dir = resolve(this.filesBase, a.kind, a.id);
      const rel = relative(this.filesBase, dir);
      if (rel.startsWith('..') || isAbsolute(rel) || !a.kind || !a.id || a.kind.includes('..') || a.id.includes('..')) continue;
      let names: string[];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name !== a.version) await fsp.rm(join(dir, name), { recursive: true, force: true });
      }
    }
  }

  /** Remove empty directories from `dir` upwards, stopping at (and keeping) `base`. */
  private async prune(base: string, dir: string): Promise<void> {
    let cur = resolve(dir);
    while (cur !== base) {
      const rel = relative(base, cur);
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return;
      try {
        await fsp.rmdir(cur);
      } catch {
        return; // not empty, or already gone
      }
      cur = dirname(cur);
    }
  }
}

/** Registry document as one JSON file, written tmp + rename. */
export class FsAssetRegistryStore implements IAssetRegistryStore {
  constructor(private readonly file: string) {}

  async load(): Promise<AssetRegistrySnapshot | null> {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.file, 'utf8')) as AssetRegistrySnapshot;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(snapshot: AssetRegistrySnapshot): Promise<void> {
    try {
      await fsp.mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(snapshot));
      await fsp.rename(tmp, this.file);
    } catch (e) {
      throw toAssetError(e, 'saving the asset registry');
    }
  }
}
