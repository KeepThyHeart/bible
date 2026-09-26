/**
 * ZIP container for the backup payload (fflate; no Node imports).
 *
 * The writer produces a plain, standard ZIP: stored or deflate entries, sizes and
 * CRCs in the local headers, fixed timestamps (so equal input gives equal bytes).
 * The reader is deliberately strict, because a backup is untrusted input: it
 * rejects unsafe names, duplicate names, unsupported methods, entries whose
 * declared sizes are missing or exceeded, and suspicious compression ratios.
 */
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from 'fflate';
import type { ZipOptions } from 'fflate';
import type { ByteSource } from './Streams';

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
    Object.setPrototypeOf(this, ZipError.prototype);
  }
}

export interface ZipLimits {
  /** Most entries accepted. */
  maxEntries: number;
  /** Largest single entry, uncompressed, in bytes. */
  maxEntryBytes: number;
  /** Largest total uncompressed size, in bytes. */
  maxTotalBytes: number;
  /** Uncompressed:compressed ratio above which an entry is refused (only entries over `ratioMinBytes`). */
  maxRatio: number;
  ratioMinBytes: number;
  /** Longest entry name. */
  maxNameLength: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 200_000,
  maxEntryBytes: 2 * 1024 ** 3,
  maxTotalBytes: 8 * 1024 ** 3,
  maxRatio: 100,
  ratioMinBytes: 1024 * 1024,
  maxNameLength: 512,
};

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Entry names are fixed-shape POSIX paths: no leading slash, no `.`/`..`/empty
 * segments, no backslash, no NUL or other control characters, no drive letter.
 * Returns an error message, or null when the name is acceptable.
 */
export function checkEntryName(name: string, maxLength = DEFAULT_ZIP_LIMITS.maxNameLength): string | null {
  if (name.length === 0 || name.length > maxLength) return 'entry name has an invalid length';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(name)) return 'entry name contains a control character or backslash';
  if (name.startsWith('/')) return 'entry name is absolute';
  if (/^[A-Za-z]:/.test(name)) return 'entry name has a drive letter';
  const dir = name.endsWith('/');
  const segments = (dir ? name.slice(0, -1) : name).split('/');
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..') return 'entry name has an empty or relative segment';
  }
  return null;
}

// fflate stores the LOCAL calendar fields, so a local-time constructor gives identical bytes in every time zone.
const ZIP_EPOCH = new Date(1980, 0, 1, 12, 0, 0);

/**
 * Build a ZIP from entries in the given order. Names are validated with the
 * same rules the reader applies, so the writer cannot produce a file the reader refuses.
 */
export function writeZip(entries: Iterable<ZipEntry & { store?: boolean }>): Uint8Array {
  const files: Record<string, [Uint8Array, ZipOptions]> = {};
  const seen = new Set<string>();
  for (const e of entries) {
    const bad = checkEntryName(e.name);
    if (bad) throw new ZipError(`${bad}: ${JSON.stringify(e.name)}`);
    const folded = e.name.toLowerCase();
    if (seen.has(folded)) throw new ZipError(`duplicate entry name: ${JSON.stringify(e.name)}`);
    seen.add(folded);
    files[e.name] = [e.data, { level: e.store ? 0 : 6, mtime: ZIP_EPOCH }];
  }
  return zipSync(files);
}

/**
 * Read every entry of a ZIP from a byte stream, in archive order, buffering one
 * entry at a time. `onEntryStart` (optional) runs when an entry header has been
 * read and may throw to stop early (used to insist that the manifest comes first).
 */
export async function readZip(
  source: ByteSource,
  limits: Partial<ZipLimits> = {},
  onEntryStart?: (name: string, index: number) => void
): Promise<ZipEntry[]> {
  const lim: ZipLimits = { ...DEFAULT_ZIP_LIMITS, ...limits };
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  let sawAny = false;
  let failure: Error | null = null;
  let pending = 0;

  const fail = (msg: string): never => {
    failure = new ZipError(msg);
    throw failure;
  };

  const unzip = new Unzip((file) => {
    sawAny = true;
    const name = file.name;
    if (entries.length + 1 > lim.maxEntries) fail('too many entries');
    const badName = checkEntryName(name, lim.maxNameLength);
    if (badName) fail(`${badName}: ${JSON.stringify(name)}`);
    const folded = name.toLowerCase();
    if (seen.has(folded)) fail(`duplicate entry name: ${JSON.stringify(name)}`);
    seen.add(folded);
    if (name.endsWith('/')) return; // directory marker; nothing to read
    if (file.compression !== 0 && file.compression !== 8) fail(`unsupported compression method ${file.compression}`);
    if (file.size === undefined || file.originalSize === undefined) fail('entry sizes are not declared');
    const declared = file.originalSize as number;
    const compressed = file.size as number;
    if (declared > lim.maxEntryBytes) fail(`entry is too large: ${JSON.stringify(name)}`);
    if (total + declared > lim.maxTotalBytes) fail('archive is too large');
    if (declared > lim.ratioMinBytes && declared > compressed * lim.maxRatio) {
      fail(`entry has a suspicious compression ratio: ${JSON.stringify(name)}`);
    }
    onEntryStart?.(name, entries.length);

    pending++;
    const parts: Uint8Array[] = [];
    let got = 0;
    file.ondata = (err, chunk, final) => {
      if (err) fail(`corrupt entry ${JSON.stringify(name)}`);
      got += chunk.length;
      if (got > declared) fail(`entry exceeds its declared size: ${JSON.stringify(name)}`);
      parts.push(chunk);
      if (final) {
        if (got !== declared) fail(`entry is shorter than its declared size: ${JSON.stringify(name)}`);
        const data = new Uint8Array(got);
        let o = 0;
        for (const p of parts) {
          data.set(p, o);
          o += p.length;
        }
        total += got;
        pending--;
        entries.push({ name, data });
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);

  const push = (chunk: Uint8Array, final: boolean): void => {
    try {
      unzip.push(chunk, final);
    } catch (e) {
      if (failure) throw failure;
      throw new ZipError(`not a valid ZIP file (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  for await (const chunk of source as AsyncIterable<Uint8Array>) {
    if (chunk.length > 0) push(chunk, false);
  }
  push(new Uint8Array(0), true);
  if (!sawAny) throw new ZipError('archive has no entries');
  if (pending > 0) throw new ZipError('archive is truncated');
  return entries;
}
