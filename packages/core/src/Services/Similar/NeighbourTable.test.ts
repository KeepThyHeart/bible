import { describe, it, expect } from 'vitest';
import { NeighbourTable, NeighbourTableError, encodeNeighbourTable } from './NeighbourTable';
import type { NeighbourHit, NeighbourTableMeta } from './SimilarTypes';

const meta: NeighbourTableMeta = {
  neighbourFloor: 0.55,
  scoreMin: 0.4,
  scoreMax: 1,
  k: 30,
  levels: ['verse', 'paragraph'],
  excludeWindow: 2,
  builder: 'test',
};

const hit = (s: number, e: number, score: number, level: NeighbourHit['level'] = 'verse'): NeighbourHit => ({
  startVerseId: s,
  endVerseId: e,
  level,
  score,
});
const vkey = (id: number) => ({ startVerseId: id, endVerseId: id, level: 'verse' as const });

function sample(): Uint8Array {
  return encodeNeighbourTable(meta, [
    // Deliberately unsorted: the encoder sorts.
    { key: vkey(43003016), neighbours: [hit(45005008, 45005008, 0.9), hit(62004009, 62004009, 0.7)] },
    { key: vkey(19023001), neighbours: [hit(43010011, 43010011, 0.8), hit(26034011, 26034011, 0.6)] },
    { key: vkey(19023002), neighbours: [hit(43010011, 43010011, 0.85), hit(23040011, 23040011, 0.65, 'paragraph')] },
    {
      key: { startVerseId: 19023001, endVerseId: 19023003, level: 'paragraph' },
      neighbours: [hit(43010001, 43010018, 0.75, 'paragraph')],
    },
  ]);
}

describe('NeighbourTable', () => {
  it('round-trips meta, keys and neighbours within the quantisation error', () => {
    const t = NeighbourTable.fromBytes(sample());
    expect(t.meta).toEqual(meta);
    expect(t.neighbourFloor()).toBe(0.55);

    const list = t.lookup({ startVerseId: 43003016, endVerseId: 43003016 })!;
    expect(list.map(h => h.startVerseId)).toEqual([45005008, 62004009]);
    const tol = (meta.scoreMax - meta.scoreMin) / 510 + 1e-9;
    expect(Math.abs(list[0].score - 0.9)).toBeLessThanOrEqual(tol);
    expect(Math.abs(list[1].score - 0.7)).toBeLessThanOrEqual(tol);
  });

  it('bounds the quantisation error over a sweep and clamps out-of-range scores', () => {
    const scores = Array.from({ length: 101 }, (_, i) => 0.4 + (i / 100) * 0.6);
    const bytes = encodeNeighbourTable(meta, [
      { key: vkey(1001001), neighbours: [...scores.map((s, i) => hit(2000000 + i, 2000000 + i, s)), hit(3000001, 3000001, 2), hit(3000002, 3000002, -1)] },
    ]);
    const list = NeighbourTable.fromBytes(bytes).lookup({ startVerseId: 1001001, endVerseId: 1001001 })!;
    for (let i = 0; i < scores.length; i++) {
      expect(Math.abs(list[i].score - scores[i])).toBeLessThanOrEqual(0.6 / 510 + 1e-9);
    }
    expect(list[101].score).toBeCloseTo(1, 6);
    expect(list[102].score).toBeCloseTo(0.4, 6);
  });

  it('prefers the verse key for a single verse and finds paragraph keys by range', () => {
    const t = NeighbourTable.fromBytes(sample());
    expect(t.lookup({ startVerseId: 19023001, endVerseId: 19023001 })![0].startVerseId).toBe(43010011);
    const para = t.lookup({ startVerseId: 19023001, endVerseId: 19023003 })!;
    expect(para).toHaveLength(1);
    expect(para[0].level).toBe('paragraph');
    expect(para[0].endVerseId).toBe(43010018);
  });

  it('returns null for unknown keys', () => {
    const t = NeighbourTable.fromBytes(sample());
    expect(t.lookup({ startVerseId: 1001001, endVerseId: 1001001 })).toBeNull();
    expect(t.lookup({ startVerseId: 19023001, endVerseId: 19023002 })).toBeNull();
    expect(t.lookupUnion({ startVerseId: 1001001, endVerseId: 1001005 })).toBeNull();
  });

  it('merges a range by max score and orders the result', () => {
    const t = NeighbourTable.fromBytes(sample());
    const union = t.lookupUnion({ startVerseId: 19023001, endVerseId: 19023003 })!;
    expect(union.map(h => `${h.level}:${h.startVerseId}`)).toEqual([
      'verse:43010011',
      'paragraph:23040011',
      'verse:26034011',
    ]);
    // 43010011 appears in both lists (0.8 and 0.85): the larger wins.
    expect(union[0].score).toBeGreaterThan(0.83);
    for (let i = 1; i < union.length; i++) expect(union[i - 1].score).toBeGreaterThanOrEqual(union[i].score);
  });

  it('ignores verse keys that end past the range', () => {
    const t = NeighbourTable.fromBytes(sample());
    const union = t.lookupUnion({ startVerseId: 19023002, endVerseId: 19023002 })!;
    expect(union.map(h => h.startVerseId)).toEqual([43010011, 23040011]);
  });

  it('handles an empty table', () => {
    const t = NeighbourTable.fromBytes(encodeNeighbourTable(meta, []));
    expect(t.lookup({ startVerseId: 1001001, endVerseId: 1001001 })).toBeNull();
    expect(t.lookupUnion({ startVerseId: 1001001, endVerseId: 1001002 })).toBeNull();
  });

  it('round-trips non-ASCII metadata', () => {
    const m = { ...meta, builder: 'Psaume 23 - berger — 牧者 \u{1F411}' };
    const t = NeighbourTable.fromBytes(encodeNeighbourTable(m, [{ key: vkey(1001001), neighbours: [] }]));
    expect(t.meta.builder).toBe(m.builder);
    expect(t.lookup({ startVerseId: 1001001, endVerseId: 1001001 })).toEqual([]);
  });

  it('reads from a subarray with a non-zero byte offset', () => {
    const bytes = sample();
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 8);
    const t = NeighbourTable.fromBytes(padded.subarray(8));
    expect(t.lookup({ startVerseId: 43003016, endVerseId: 43003016 })).toHaveLength(2);
  });

  it('throws typed errors', () => {
    const bytes = sample();
    const catchCode = (b: Uint8Array): string | undefined => {
      try {
        NeighbourTable.fromBytes(b);
      } catch (e) {
        expect(e).toBeInstanceOf(NeighbourTableError);
        return (e as NeighbourTableError).code;
      }
      return undefined;
    };

    const badMagic = bytes.slice();
    badMagic[0] = 0x58;
    expect(catchCode(badMagic)).toBe('magic');

    const v2 = bytes.slice();
    new DataView(v2.buffer).setUint16(4, 2, true);
    expect(catchCode(v2)).toBe('version');

    expect(catchCode(bytes.slice(0, bytes.length - 5))).toBe('truncated');
    expect(catchCode(bytes.slice(0, 10))).toBe('truncated');

    const badMeta = bytes.slice();
    badMeta[16] = 0x7e; // breaks the JSON
    expect(catchCode(badMeta)).toBe('meta');
  });
});
