/**
 * A minimal, dependency-free ZIP writer.
 *
 * This package is installed by extension authors outside this repository, so
 * every dependency it takes becomes theirs. `archiver` and `jszip` are both
 * present in the monorepo's tree, but only transitively via electron-builder -
 * depending on either would mean adding a real dependency (and its own tree) to
 * a package whose entire job is to be cheap to install. Node ships `zlib`, and
 * the format needed here is one method and three record types, so it is written
 * out rather than pulled in.
 *
 * Deflate (method 8), not stored: extension bundles are mostly JavaScript, which
 * compresses several-fold, and the catalog path downloads these over a network.
 *
 * **Archives are byte-for-byte reproducible.** Every entry is stamped with a
 * fixed DOS timestamp instead of its mtime, so the same input tree always
 * produces the same bytes and therefore the same SHA-256. That matters because
 * `installFromCatalog` verifies a published digest before unpacking: a build
 * that changed its hash on every run would make that check impossible for an
 * author to reproduce, and mtime is not part of what anyone is publishing.
 *
 * Reference: PKWARE APPNOTE.TXT sections 4.3.7 (local header), 4.3.12 (central
 * directory), 4.3.16 (end of central directory).
 */

import { deflateRawSync } from 'node:zlib';

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Version 2.0 — the minimum that understands deflate. */
const VERSION = 20;
const METHOD_DEFLATE = 8;

/**
 * 1980-01-01 00:00:00, the earliest the DOS date format can express. Fixed
 * rather than "now" so archives are reproducible; see the note above.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** Regular file, mode 0644, in the high 16 bits where unzip tools look. */
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

export interface ZipEntry {
  /** Path inside the archive. Always forward slashes, never leading `/`. */
  path: string;
  content: Buffer;
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(buf: Buffer): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface StagedEntry {
  nameBytes: Buffer;
  compressed: Buffer;
  crc: number;
  uncompressedSize: number;
  offset: number;
}

/** Build a `.zip` archive containing `entries`, in the order given. */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const staged: StagedEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, 'utf8');
    const compressed = deflateRawSync(entry.content);
    const crc = crc32(entry.content);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(METHOD_DEFLATE, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.content.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28); // extra field length

    chunks.push(header, nameBytes, compressed);
    staged.push({
      nameBytes,
      compressed,
      crc,
      uncompressedSize: entry.content.length,
      offset,
    });
    offset += header.length + nameBytes.length + compressed.length;
  }

  const centralStart = offset;
  for (const entry of staged) {
    const record = Buffer.alloc(46);
    record.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    record.writeUInt16LE(VERSION, 4); // version made by
    record.writeUInt16LE(VERSION, 6); // version needed
    record.writeUInt16LE(0, 8); // flags
    record.writeUInt16LE(METHOD_DEFLATE, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(entry.crc, 16);
    record.writeUInt32LE(entry.compressed.length, 20);
    record.writeUInt32LE(entry.uncompressedSize, 24);
    record.writeUInt16LE(entry.nameBytes.length, 28);
    record.writeUInt16LE(0, 30); // extra length
    record.writeUInt16LE(0, 32); // comment length
    record.writeUInt16LE(0, 34); // disk number start
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE(EXTERNAL_ATTRS, 38);
    record.writeUInt32LE(entry.offset, 42);

    chunks.push(record, entry.nameBytes);
    offset += record.length + entry.nameBytes.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(staged.length, 8);
  eocd.writeUInt16LE(staged.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  chunks.push(eocd);

  return Buffer.concat(chunks);
}
