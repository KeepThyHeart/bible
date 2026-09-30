/**
 * Precomputed neighbour table for similar passages (task 0070).
 *
 * Binary layout `SNB1` (little-endian, 4-byte aligned so DataView reads stay simple):
 *
 *   0   'SNB1'   4 version u16 = 1   6 K u16   8 keyCount u32   12 metaLen u32   16 meta UTF-8 JSON, padded to 4
 *   keys:    keyCount x 16 B { start i32, end i32, level u8, count u8, pad u16, first u32 }  sorted (start, end, level)
 *   entries: total x 12 B    { start i32, end i32, level u8, score u8, pad u16 }             per key, score descending
 *   score = scoreMin + q / 255 * (scoreMax - scoreMin)
 *
 * Browser-safe: no Node imports.
 */

import type {
  INeighbourTable,
  NeighbourHit,
  NeighbourTableMeta,
  PassageRange,
  SemanticLevel,
} from './SimilarTypes';

const MAGIC = [0x53, 0x4e, 0x42, 0x31]; // 'SNB1'
const VERSION = 1;
const HEADER_BYTES = 16;
const KEY_BYTES = 16;
const ENTRY_BYTES = 12;

const LEVELS: readonly SemanticLevel[] = ['verse', 'paragraph', 'chapter'];

export class NeighbourTableError extends Error {
  constructor(
    public readonly code: 'magic' | 'version' | 'truncated' | 'meta',
    message: string
  ) {
    super(message);
    this.name = 'NeighbourTableError';
  }
}

export interface NeighbourTableKey {
  startVerseId: number;
  endVerseId: number;
  level: SemanticLevel;
}

function levelIndex(level: SemanticLevel): number {
  const index = LEVELS.indexOf(level);
  if (index < 0) throw new Error(`Unknown level "${level}"`);
  return index;
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function compareKeys(a: NeighbourTableKey, b: NeighbourTableKey): number {
  return (
    a.startVerseId - b.startVerseId ||
    a.endVerseId - b.endVerseId ||
    levelIndex(a.level) - levelIndex(b.level)
  );
}

export function encodeNeighbourTable(
  meta: NeighbourTableMeta,
  keys: Array<{ key: NeighbourTableKey; neighbours: NeighbourHit[] }>
): Uint8Array {
  const sorted = [...keys].sort((a, b) => compareKeys(a.key, b.key));
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const metaPadded = pad4(metaBytes.length);
  const total = sorted.reduce((sum, k) => sum + k.neighbours.length, 0);

  const keysOffset = HEADER_BYTES + metaPadded;
  const entriesOffset = keysOffset + sorted.length * KEY_BYTES;
  const out = new Uint8Array(entriesOffset + total * ENTRY_BYTES);
  const view = new DataView(out.buffer);

  out.set(MAGIC, 0);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, Math.min(0xffff, Math.max(meta.k, 0)), true);
  view.setUint32(8, sorted.length, true);
  view.setUint32(12, metaBytes.length, true);
  out.set(metaBytes, HEADER_BYTES);

  const range = meta.scoreMax - meta.scoreMin;
  let first = 0;
  sorted.forEach((entry, i) => {
    if (entry.neighbours.length > 255) {
      throw new Error(`Neighbour list of ${entry.neighbours.length} entries exceeds 255`);
    }
    const at = keysOffset + i * KEY_BYTES;
    view.setInt32(at, entry.key.startVerseId, true);
    view.setInt32(at + 4, entry.key.endVerseId, true);
    view.setUint8(at + 8, levelIndex(entry.key.level));
    view.setUint8(at + 9, entry.neighbours.length);
    view.setUint32(at + 12, first, true);

    for (const hit of entry.neighbours) {
      const e = entriesOffset + first * ENTRY_BYTES;
      view.setInt32(e, hit.startVerseId, true);
      view.setInt32(e + 4, hit.endVerseId, true);
      view.setUint8(e + 8, levelIndex(hit.level));
      const q = range > 0 ? Math.round(((hit.score - meta.scoreMin) / range) * 255) : 0;
      view.setUint8(e + 9, Math.max(0, Math.min(255, q)));
      first++;
    }
  });

  return out;
}

export class NeighbourTable implements INeighbourTable {
  private constructor(
    public readonly meta: NeighbourTableMeta,
    private readonly view: DataView,
    private readonly keyCount: number,
    private readonly keysOffset: number,
    private readonly entriesOffset: number
  ) {}

  static fromBytes(bytes: Uint8Array): NeighbourTable {
    if (bytes.byteLength < HEADER_BYTES) {
      throw new NeighbourTableError('truncated', 'Neighbour table is shorter than its header');
    }
    for (let i = 0; i < MAGIC.length; i++) {
      if (bytes[i] !== MAGIC[i]) throw new NeighbourTableError('magic', 'Not a neighbour table (bad magic)');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint16(4, true);
    if (version > VERSION) {
      throw new NeighbourTableError('version', `Neighbour table version ${version} is newer than this app understands`);
    }
    const keyCount = view.getUint32(8, true);
    const metaLen = view.getUint32(12, true);
    const keysOffset = HEADER_BYTES + pad4(metaLen);
    const entriesOffset = keysOffset + keyCount * KEY_BYTES;
    if (entriesOffset > bytes.byteLength) {
      throw new NeighbourTableError('truncated', 'Neighbour table ends inside its header or key block');
    }

    let meta: NeighbourTableMeta;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(HEADER_BYTES, HEADER_BYTES + metaLen)
      );
      meta = JSON.parse(text) as NeighbourTableMeta;
    } catch {
      throw new NeighbourTableError('meta', 'Neighbour table metadata is not valid JSON');
    }
    if (
      !meta ||
      typeof meta !== 'object' ||
      !Number.isFinite(meta.neighbourFloor) ||
      !Number.isFinite(meta.scoreMin) ||
      !Number.isFinite(meta.scoreMax)
    ) {
      throw new NeighbourTableError('meta', 'Neighbour table metadata is missing its score range');
    }

    const totalEntries = Math.floor((bytes.byteLength - entriesOffset) / ENTRY_BYTES);
    // Every key must point inside the entries block.
    for (let i = 0; i < keyCount; i++) {
      const at = keysOffset + i * KEY_BYTES;
      const extent = view.getUint32(at + 12, true) + view.getUint8(at + 9);
      if (extent > totalEntries) {
        throw new NeighbourTableError('truncated', 'Neighbour table ends inside its entry block');
      }
    }
    return new NeighbourTable(meta, view, keyCount, keysOffset, entriesOffset);
  }

  neighbourFloor(): number {
    return this.meta.neighbourFloor;
  }

  /** Number of keys (lists) in the table. */
  get size(): number {
    return this.keyCount;
  }

  lookup(r: PassageRange): NeighbourHit[] | null {
    let at = this.findKey(r.startVerseId, r.endVerseId, 0);
    if (at < 0) at = this.findKey(r.startVerseId, r.endVerseId, 1);
    return at < 0 ? null : this.readList(at);
  }

  lookupUnion(r: PassageRange): NeighbourHit[] | null {
    let i = this.lowerBound(r.startVerseId);
    const merged = new Map<string, NeighbourHit>();
    let found = false;
    for (; i < this.keyCount; i++) {
      const at = this.keysOffset + i * KEY_BYTES;
      const start = this.view.getInt32(at, true);
      if (start > r.endVerseId) break;
      if (this.view.getUint8(at + 8) !== 0) continue; // verse keys only
      if (this.view.getInt32(at + 4, true) > r.endVerseId) continue;
      found = true;
      for (const hit of this.readList(i)) {
        const id = `${hit.level}|${hit.startVerseId}|${hit.endVerseId}`;
        const prior = merged.get(id);
        if (!prior || hit.score > prior.score) merged.set(id, hit);
      }
    }
    if (!found) return null;
    return [...merged.values()].sort(
      (a, b) =>
        b.score - a.score ||
        a.startVerseId - b.startVerseId ||
        a.endVerseId - b.endVerseId ||
        levelIndex(a.level) - levelIndex(b.level)
    );
  }

  /** Index of the first key whose start >= `start`. */
  private lowerBound(start: number): number {
    let lo = 0;
    let hi = this.keyCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.view.getInt32(this.keysOffset + mid * KEY_BYTES, true) < start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Key index for (start, end, level) or -1. */
  private findKey(start: number, end: number, level: number): number {
    let lo = 0;
    let hi = this.keyCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = this.keysOffset + mid * KEY_BYTES;
      const cmp =
        this.view.getInt32(at, true) - start ||
        this.view.getInt32(at + 4, true) - end ||
        this.view.getUint8(at + 8) - level;
      if (cmp === 0) return mid;
      if (cmp < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  private readList(keyIndex: number): NeighbourHit[] {
    const at = this.keysOffset + keyIndex * KEY_BYTES;
    const count = this.view.getUint8(at + 9);
    const first = this.view.getUint32(at + 12, true);
    const { scoreMin, scoreMax } = this.meta;
    const range = scoreMax - scoreMin;
    const out: NeighbourHit[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const e = this.entriesOffset + (first + i) * ENTRY_BYTES;
      out[i] = {
        startVerseId: this.view.getInt32(e, true),
        endVerseId: this.view.getInt32(e + 4, true),
        level: LEVELS[this.view.getUint8(e + 8)] ?? 'verse',
        score: scoreMin + (this.view.getUint8(e + 9) / 255) * range,
      };
    }
    return out;
  }
}
