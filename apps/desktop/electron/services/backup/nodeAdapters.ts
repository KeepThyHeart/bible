/**
 * Node adapters for the platform-free backup code in `@bible/core`: the notes
 * directory as a `FileSource`/`FileSink`, extension data, file streams, and the
 * safety snapshot taken before a restore.
 */
import {
  cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync,
} from 'fs';
import { open, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve, sep } from 'path';
import { Backup } from '@bible/core';
import type { Extensions, ISql } from '@bible/core';

// --- files as streams --------------------------------------------------------

/** Read a file as a byte stream (Node's `ReadStream` is an async iterable of Buffers). */
export function readFileStream(path: string): AsyncIterable<Uint8Array> {
  return createReadStream(path, { highWaterMark: 1024 * 1024 });
}

/**
 * Write a byte stream to `path` atomically: into `<path>.partial`, then renamed,
 * so a failure or a crash never leaves a half-written backup under the final name.
 */
export async function writeFileFromStream(path: string, chunks: AsyncIterable<Uint8Array>): Promise<void> {
  const tmp = `${path}.partial`;
  await mkdir(dirname(path), { recursive: true });
  const fh = await open(tmp, 'w');
  try {
    for await (const chunk of chunks) await fh.write(chunk);
    await fh.sync();
  } catch (e) {
    await fh.close().catch(() => undefined);
    rmSync(tmp, { force: true });
    throw e;
  }
  await fh.close();
  renameSync(tmp, path);
}

// --- notes directory ---------------------------------------------------------

function walk(root: string, dir: string, out: Array<{ path: string; size: number }>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) walk(root, abs, out);
    else if (e.isFile()) out.push({ path: relative(root, abs).split(sep).join('/'), size: statSync(abs).size });
  }
}

/** Resolve a relative POSIX path inside `root`, refusing anything that would escape it. */
function safeJoin(root: string, rel: string): string {
  const base = resolve(root);
  const abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error(`Path escapes the notes directory: ${rel}`);
  return abs;
}

export class NotesDirStore {
  constructor(private readonly notesDir: string) {}

  async *list(): AsyncGenerator<{ path: string; size: number }> {
    if (!existsSync(this.notesDir)) return;
    const out: Array<{ path: string; size: number }> = [];
    walk(this.notesDir, this.notesDir, out);
    yield* out;
  }

  async listPaths(): Promise<string[]> {
    const out: string[] = [];
    for await (const f of this.list()) out.push(f.path);
    return out;
  }

  async read(path: string): Promise<Uint8Array> {
    return readFile(safeJoin(this.notesDir, path));
  }

  async readIfPresent(path: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(safeJoin(this.notesDir, path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const abs = safeJoin(this.notesDir, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
  }

  /** Move the whole notes folder to `<notesDir>.before-restore-<label>` (a numbered name if that exists) and recreate it empty. */
  async moveAside(label: string): Promise<string | undefined> {
    if (!existsSync(this.notesDir)) return undefined;
    let target = `${this.notesDir}.before-restore-${label}`;
    for (let n = 2; existsSync(target); n++) target = `${this.notesDir}.before-restore-${label}-${n}`;
    renameSync(this.notesDir, target);
    mkdirSync(this.notesDir, { recursive: true });
    return target;
  }
}

/** The store as what core reads notes from. */
export function notesSource(store: NotesDirStore): Backup.FileSource {
  return { list: () => store.list(), read: (p) => store.read(p) };
}

/** The store as what core writes restored notes to. */
export function notesSink(store: NotesDirStore): Backup.FileSink {
  return {
    list: () => store.listPaths(),
    read: (p) => store.readIfPresent(p),
    write: (p, d) => store.write(p, d),
    moveAside: (l) => store.moveAside(l),
  };
}

// --- extension data -----------------------------------------------------------

export interface ExtensionPort {
  /** Installed extensions and their manifests. */
  listEntries(): Array<{ id: string; manifest: { userData?: Extensions.ExtensionUserDataConfig } }>;
  /** `<extension state root>` whose children are `<id>/db/<name>.db`. */
  dbRoot: string;
  /** Open a database file read-only (a plain SQLite connection). */
  openReadonly(path: string): ISql & { close(): void };
  /** Close every open handle an extension has before its files are replaced. */
  closeDatabases(extensionId: string): void;
}

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export class DesktopExtensionData implements Backup.ExtensionDataSource, Backup.ExtensionDataSink {
  constructor(private readonly port: ExtensionPort) {}

  private dbPath(id: string, name: string): string {
    if (!Backup.EXTENSION_ID_PATTERN.test(id) || !Backup.EXTENSION_DB_NAME_PATTERN.test(name)) {
      throw new Error('Unsafe extension database name');
    }
    return join(this.port.dbRoot, id, 'db', `${name}.db`);
  }

  async list(): Promise<Backup.ExtensionBackupDecl[]> {
    return this.port.listEntries().map((e) => Backup.resolveExtensionBackup(e.id, e.manifest.userData));
  }

  /** A consistent copy made with `VACUUM INTO`, never the live file. */
  async dbSnapshot(id: string, name: string): Promise<Uint8Array> {
    const src = this.dbPath(id, name);
    const dir = mkdtempSync(join(tmpdir(), 'kth-extdb-'));
    const out = join(dir, 'snapshot.db');
    try {
      const db = this.port.openReadonly(src);
      try {
        db.execute(`VACUUM INTO ${q(out)}`);
      } finally {
        db.close();
      }
      return await readFile(out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async dbExists(id: string, name: string): Promise<boolean> {
    return existsSync(this.dbPath(id, name));
  }

  async writeDb(id: string, name: string, data: Uint8Array): Promise<void> {
    const path = this.dbPath(id, name);
    this.port.closeDatabases(id);
    await mkdir(dirname(path), { recursive: true });
    for (const side of ['-wal', '-shm', '-journal']) rmSync(path + side, { force: true });
    await writeFile(path, data);
  }
}

// --- safety snapshot -----------------------------------------------------------

export interface SnapshotOptions {
  userDbPath: string;
  notesDir?: string;
  root: string;
  keep?: number;
  now?: () => Date;
}

/**
 * Copy the (still encrypted) user database file and the notes folder to
 * `<root>/<timestamp>/` before a restore changes anything, and keep only the
 * newest few. Returns the folder written.
 */
export function createPreRestoreSnapshot(o: SnapshotOptions): string {
  const stamp = (o.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, '-');
  const dir = join(o.root, stamp);
  mkdirSync(dir, { recursive: true });
  if (existsSync(o.userDbPath)) copyFileSync(o.userDbPath, join(dir, 'user_default.db'));
  if (o.notesDir && existsSync(o.notesDir)) cpSync(o.notesDir, join(dir, 'notes'), { recursive: true });
  const all = readdirSync(o.root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const old of all.slice(0, Math.max(0, all.length - (o.keep ?? 3)))) rmSync(join(o.root, old), { recursive: true, force: true });
  return dir;
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}
