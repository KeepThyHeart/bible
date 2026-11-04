/**
 * `.bn` file-notes sync adapter (task 0150 W3-E, contracts 0063 section 10: record type 'bn.file').
 *
 * Reads and writes the notes directory directly (same on-disk conventions as BibleNotesFileService: JSON files ending
 * in `.bn`, atomic `.tmp` + rename writes, `.bak` history beside them) but does not import that service, which pulls
 * in Electron. `.bak`, hidden files and temp files never sync, and `.bak` history is never touched here.
 *
 * Record shape (BnFileData): { path, bn, mtime }. Local key = the file's path relative to notesDir with '/' separators,
 * in its on-disk spelling. Record id = deriveRecordId(idk, 'bn.file', lowercased NFC path); the engine derives it from
 * `codec.naturalKey(d)`, so two devices agree on the id of a path regardless of case or Unicode normalisation.
 *
 * Change detection (`collect`): a scan compares each file's mtime+size with the adapter state, and only re-hashes
 * (sha256) files whose stat changed; a changed hash marks the file dirty. Files missing from the state are marked
 * dirty (new), state entries without a file are marked dirty+deleted (deleted; a rename is the old path deleted plus
 * the new path new). The state lives in memory, and in `stateFile` (atomic JSON, user data dir) when given. Without
 * `stateFile` the first scan after a restart marks every file dirty (harmless, re-uploads identical content) and files
 * deleted while the app was closed are not noticed, so the host should pass a `stateFile`.
 *
 * Remote writes (and deletes) are staged by the codec, which runs inside the engine's SQL transaction, and are
 * applied to disk in `afterApply` once the transaction has committed, so a rolled-back record leaves no file behind.
 * A remote delete renames the file to `<name>.bn.deleted-<date>.bak` instead of unlinking it.
 * Remote writes update the state, so applying a remote file is never echoed back as a local change.
 * Files over the record limit are skipped with `warn(path, 'too-large')` (decision D9).
 * Conflicts: the engine applies the winner through `upsert` and calls `conflictCopy` with the loser, which is saved as
 * `<name> (conflicted copy YYYY-MM-DD).bn` beside the file.
 */
import fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import type { Sync } from '@bible/core';

export const BN_KIND = 'bn.file';
/** Same as Sync.MAX_RECORD_JSON (1 MiB - 4), kept local to avoid a runtime import of the barrel. */
const MAX_RECORD_JSON = 1024 * 1024 - 4;
/** Room for the RecordPlaintext wrapper (t, cv, h, dev) around `d`. */
const WRAPPER_OVERHEAD = 256;

export type BnWarnReason = 'too-large' | 'invalid-json' | 'unreadable' | 'path-collision';

export interface BnFileSyncAdapterOptions {
  /** Absolute notes directory. */
  notesDir: string;
  /** Mark a file dirty in the change tracker (propose `tracker.touch(kind, localKey, { deleted })`). */
  markDirty(kind: string, localKey: string, deleted: boolean): void;
  /** Per-file warning surfaced in sync status. Never receives file contents. */
  warn?(relPath: string, reason: BnWarnReason): void;
  /** Called from afterApply with the notes files the engine changed, so the app can refresh its watcher / UI. */
  onFilesChanged?(changed: Array<{ localKey: string; deleted: boolean }>): void;
  /** Optional JSON file (in the user data dir) that persists the scan state across restarts. */
  stateFile?: string;
  now?: () => Date;
}

export interface BnFileSyncAdapter extends Sync.SyncAdapter {
  /** Save the losing side of a conflict as `<name> (conflicted copy <date>).bn`; returns the new local key. */
  conflictCopy(localKey: string, copy: Record<string, unknown>): string;
}

interface FileState { mtimeMs: number; size: number; hash: string }

/** Lowercased NFC path: the natural key for the record id. */
export function bnNaturalKey(relPath: string): string {
  return relPath.normalize('NFC').toLowerCase();
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Returns the normalised relative path ('/' separators) or null when it is not a safe `.bn` path. */
export function sanitizeBnPath(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024) return null;
  if (p.includes('\0')) return null;
  const s = p.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return null;
  const parts = s.split('/');
  if (parts.some((x) => x === '' || x === '.' || x === '..')) return null;
  if (parts.some((x) => x.endsWith('.tmp') || x.startsWith('.'))) return null;
  // Windows: alternate data streams (':'), names that end in a dot or space, and reserved device names
  // (with or without an extension: "con", "NUL.bn", "com1.txt.bn").
  if (parts.some((x) => x.includes(':') || /[. ]$/.test(x) || WINDOWS_RESERVED.test(x.split('.')[0].trimEnd()))) return null;
  if (!s.endsWith('.bn') || parts[parts.length - 1].length <= 3) return null;
  return s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Temp file + fsync + rename in the destination directory; the destination is never partially written. */
function atomicWrite(full: string, data: string | Buffer): void {
  const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${randomBytes(6).toString('hex')}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    if (typeof data === 'string') fs.writeSync(fd, data);
    else fs.writeSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, full);
  } catch (err) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

export function createBnFileSyncAdapter(o: BnFileSyncAdapterOptions): BnFileSyncAdapter {
  const root = path.resolve(o.notesDir);
  const now = o.now ?? (() => new Date());
  const state = new Map<string, FileState>();
  let stateLoaded = false;
  /**
   * Remote writes and deletes staged by `upsert`/`remove` (which run inside the engine's SQL transaction, where a
   * savepoint rollback would otherwise leave a file with no sync row) and applied to disk in `afterApply`,
   * after the commit. The paths are validated when staged, so an unsafe record still fails the transaction.
   */
  const staged = new Map<string, { op: 'write'; data: string; mtime: string } | { op: 'delete' }>();

  const warn = (p: string, reason: BnWarnReason): void => { o.warn?.(p, reason); };

  function loadState(): void {
    if (stateLoaded) return;
    stateLoaded = true;
    if (!o.stateFile) return;
    try {
      const j = JSON.parse(fs.readFileSync(o.stateFile, 'utf-8')) as { v?: number; files?: Record<string, FileState> };
      if (j.v !== 1 || !isPlainObject(j.files)) return;
      for (const [k, s] of Object.entries(j.files)) {
        if (s && typeof s.mtimeMs === 'number' && typeof s.size === 'number' && typeof s.hash === 'string') state.set(k, s);
      }
    } catch { /* missing or damaged state: start from scratch */ }
  }

  function saveState(): void {
    if (!o.stateFile) return;
    try {
      fs.mkdirSync(path.dirname(o.stateFile), { recursive: true });
      atomicWrite(o.stateFile, JSON.stringify({ v: 1, files: Object.fromEntries(state) }));
    } catch { /* state is an optimisation; a failed save only costs a rescan */ }
  }

  /** The real path of the deepest existing ancestor of `dir` (itself when it exists). */
  function realExistingAncestor(dir: string): string {
    let cur = dir;
    for (;;) {
      try { return fs.realpathSync(cur); } catch { /* not there (or dangling): go up */ }
      const up = path.dirname(cur);
      if (up === cur) return cur;
      cur = up;
    }
  }

  function insideRoot(real: string): boolean {
    let realRoot: string;
    try { realRoot = fs.realpathSync(root); } catch { realRoot = root; }
    return real === realRoot || real.startsWith(realRoot + path.sep);
  }

  /**
   * Absolute path for a relative path, checked lexically and through symlinks. The symlink check runs on the
   * deepest existing ancestor BEFORE any directory is created, so a symlinked intermediate directory cannot
   * make mkdir create (empty) directories outside the root; it is repeated after mkdir.
   */
  function resolveInside(rel: string, create: boolean): string {
    const safe = sanitizeBnPath(rel);
    if (!safe) throw new Error('Unsafe .bn path');
    const full = path.resolve(root, ...safe.split('/'));
    if (!full.startsWith(root + path.sep)) throw new Error('Unsafe .bn path');
    const parent = path.dirname(full);
    if (!insideRoot(realExistingAncestor(parent))) throw new Error('Unsafe .bn path');
    if (create) {
      fs.mkdirSync(parent, { recursive: true });
      if (!insideRoot(fs.realpathSync(parent))) throw new Error('Unsafe .bn path');
    }
    return full;
  }

  function recordState(rel: string, full: string): void {
    try {
      const st = fs.statSync(full);
      state.set(rel, { mtimeMs: st.mtimeMs, size: st.size, hash: sha256(fs.readFileSync(full)) });
    } catch { state.delete(rel); }
  }

  /** All `.bn` files below root as relative paths, sorted; hidden entries, symlinks, .bak and temp files skipped. */
  function scan(): string[] {
    const out: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), rel);
        else if (e.isFile() && e.name.endsWith('.bn') && sanitizeBnPath(rel)) out.push(rel);
      }
    };
    walk(root, '');
    return out.sort();
  }

  function readParsed(rel: string): { bn: Record<string, unknown>; mtime: string; size: number } | null {
    try {
      const full = resolveInside(rel, false);
      const st = fs.statSync(full);
      if (!st.isFile()) return null;
      const raw = fs.readFileSync(full, 'utf-8');
      const bn: unknown = JSON.parse(raw);
      if (!isPlainObject(bn)) { warn(rel, 'invalid-json'); return null; }
      return { bn, mtime: st.mtime.toISOString(), size: Buffer.byteLength(raw) };
    } catch (err) {
      warn(rel, err instanceof SyntaxError ? 'invalid-json' : 'unreadable');
      return null;
    }
  }

  const codec: Sync.RecordCodec = {
    type: BN_KIND,
    kind: BN_KIND,
    version: 1,

    encode(localKey) {
      const parsed = readParsed(localKey);
      if (!parsed) return null;
      const d = { path: localKey, bn: parsed.bn, mtime: parsed.mtime };
      if (Buffer.byteLength(JSON.stringify(d)) + WRAPPER_OVERHEAD > MAX_RECORD_JSON) {
        warn(localKey, 'too-large');
        return null;
      }
      return d;
    },

    decode(d) {
      const p = sanitizeBnPath(d['path']);
      if (!p || !isPlainObject(d['bn']) || typeof d['mtime'] !== 'string') {
        throw new Error('Invalid bn.file record');
      }
      return { ok: true, row: { path: p, bn: d['bn'], mtime: d['mtime'] } };
    },

    upsert(row, localKey) {
      const p = sanitizeBnPath(row['path']);
      if (!p || !isPlainObject(row['bn'])) throw new Error('Invalid bn.file record');
      // Keep the existing on-disk spelling when the same path differs only by case / normalisation.
      const rel = localKey && sanitizeBnPath(localKey) && bnNaturalKey(localKey) === bnNaturalKey(p) ? sanitizeBnPath(localKey)! : p;
      resolveInside(rel, false); // validate now (a throw rolls the record back); write after commit
      staged.set(rel, { op: 'write', data: JSON.stringify(row['bn']), mtime: typeof row['mtime'] === 'string' ? row['mtime'] : '' });
      return rel;
    },

    remove(localKey) {
      resolveInside(localKey, false);
      staged.set(sanitizeBnPath(localKey)!, { op: 'delete' });
    },

    naturalKey(d) {
      const p = sanitizeBnPath(d['path']);
      return p ? { scope: BN_KIND, key: bnNaturalKey(p) } : null;
    },
  };

  /** Apply the staged remote writes/deletes (post-commit). A failing file is warned about; the rest proceed. */
  function flushStaged(): void {
    if (staged.size === 0) return;
    loadState();
    const batch = [...staged];
    staged.clear();
    for (const [rel, op] of batch) {
      try {
        const full = resolveInside(rel, op.op === 'write');
        if (op.op === 'write') {
          atomicWrite(full, op.data);
          const when = op.mtime ? new Date(op.mtime) : null;
          if (when && !Number.isNaN(when.getTime())) { try { fs.utimesSync(full, when, when); } catch { /* cosmetic */ } }
          recordState(rel, full);
        } else {
          keepDeletedCopy(full);
          state.delete(rel);
        }
      } catch {
        warn(rel, 'unreadable');
      }
    }
    saveState();
  }

  /** A remote delete moves the file to `<name>.deleted-<date>.bak` beside it (`.bak` files never sync) instead of unlinking. */
  function keepDeletedCopy(full: string): void {
    if (!fs.existsSync(full)) return;
    const date = now().toISOString().slice(0, 10);
    let dest = `${full}.deleted-${date}.bak`;
    for (let n = 2; fs.existsSync(dest); n++) dest = `${full}.deleted-${date}-${n}.bak`;
    fs.renameSync(full, dest);
  }

  return {
    kind: BN_KIND,
    codec,

    async collect() {
      flushStaged(); // anything left over from an apply whose afterApply did not run
      loadState();
      const files = scan();
      const seen = new Set<string>();
      const claimed = new Map<string, string>();
      for (const rel of files) {
        const nk = bnNaturalKey(rel);
        if (claimed.has(nk)) { warn(rel, 'path-collision'); continue; }
        claimed.set(nk, rel);
        seen.add(rel);
        let st: fs.Stats;
        try { st = fs.statSync(path.join(root, ...rel.split('/'))); } catch { continue; }
        const prev = state.get(rel);
        if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue;
        let hash: string;
        try { hash = sha256(fs.readFileSync(path.join(root, ...rel.split('/')))); } catch { warn(rel, 'unreadable'); continue; }
        state.set(rel, { mtimeMs: st.mtimeMs, size: st.size, hash });
        if (!prev || prev.hash !== hash) o.markDirty(BN_KIND, rel, false);
      }
      for (const rel of [...state.keys()]) {
        if (!seen.has(rel)) {
          state.delete(rel);
          o.markDirty(BN_KIND, rel, true);
        }
      }
      saveState();
    },

    async afterApply(changed) {
      flushStaged();
      const mine = changed.filter((c) => c.kind === BN_KIND).map((c) => ({ localKey: c.localKey, deleted: c.deleted }));
      if (mine.length > 0) o.onFilesChanged?.(mine);
    },

    conflictCopy(localKey, copy) {
      const base = sanitizeBnPath(localKey);
      if (!base || !isPlainObject(copy['bn'])) throw new Error('Invalid conflict copy');
      loadState();
      const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
      const name = base.slice(dir.length, -3);
      const date = now().toISOString().slice(0, 10);
      let rel = `${dir}${name} (conflicted copy ${date}).bn`;
      for (let n = 2; fs.existsSync(resolveInside(rel, false)); n++) rel = `${dir}${name} (conflicted copy ${date} ${n}).bn`;
      const full = resolveInside(rel, true);
      atomicWrite(full, JSON.stringify(copy['bn']));
      // Not recorded in the state on purpose: the next collect() sees it as a new file and uploads it.
      o.markDirty(BN_KIND, rel, false);
      return rel;
    },
  };
}
