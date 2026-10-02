import { describe, it, expect } from 'vitest';
import { encodeQr, formatBits, qrSvg, MAX_QR_BYTES } from '../../src/present/qr';

/**
 * A wrong QR code fails silently: it renders, it looks exactly like a right
 * one, and the only symptom is a roomful of people whose phones do nothing.
 * There is no way to notice that at a desk by looking at it. So these tests do
 * not look at it.
 *
 * Instead they attack the encoder from two directions that do not share its
 * code:
 *
 *  1. A **decoder**, below, that reads the finished matrix back out. It derives
 *     the alignment pattern positions from the spec's formula rather than the
 *     encoder's transcribed table, so a typo in that table shows up as a failed
 *     round trip rather than as two matching mistakes.
 *  2. A **syndrome check** over every block, using Galois field tables built
 *     here from scratch. Every Reed-Solomon codeword evaluates to zero at the
 *     first `n - k` powers of the generator; if the generator polynomial or the
 *     division were wrong, this would not hold. That is a proof of the error
 *     correction independent of the encoder producing it.
 */

// ---------------------------------------------------------------------------
// An independently built GF(256), for the syndrome check
// ---------------------------------------------------------------------------

const exp: number[] = [];
const log: number[] = [];
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x = x << 1;
    if (x > 255) x = (x ^ 0x11d) & 0xff;
  }
}
const mul = (a: number, b: number): number =>
  (a === 0 || b === 0) ? 0 : exp[(log[a] + log[b]) % 255];

// ---------------------------------------------------------------------------
// A decoder
// ---------------------------------------------------------------------------

/** Alignment centres from the spec's construction rule, not from a table. */
function alignmentCentres(version: number): number[] {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const last = size - 7;
  const intervals = Math.floor(version / 7) + 1;
  const step = Math.ceil((last - 6) / intervals / 2) * 2;
  const centres = [6];
  for (let i = intervals - 1; i >= 0; i--) centres.push(last - i * step);
  return centres;
}

/** Which modules are function patterns, and so not data. */
function functionModules(version: number): boolean[][] {
  const size = version * 4 + 17;
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r: number, c: number): void => {
    if (r >= 0 && c >= 0 && r < size && c < size) reserved[r][c] = true;
  };

  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) mark(top + dy, left + dx);
  }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }

  const centres = alignmentCentres(version);
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder = (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(r + dy, c + dx);
    }
  }

  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      mark(r, size - 11 + c);
      mark(size - 11 + c, r);
    }
  }
  return reserved;
}

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Data and EC codewords per block, level M, versions 1-10. */
const BLOCKS: Record<number, { ec: number; sizes: number[] }> = {
  1: { ec: 10, sizes: [16] },
  2: { ec: 16, sizes: [28] },
  3: { ec: 26, sizes: [44] },
  4: { ec: 18, sizes: [32, 32] },
  5: { ec: 24, sizes: [43, 43] },
  6: { ec: 16, sizes: [27, 27, 27, 27] },
  7: { ec: 18, sizes: [31, 31, 31, 31] },
  8: { ec: 22, sizes: [38, 38, 39, 39] },
  9: { ec: 22, sizes: [36, 36, 36, 37, 37] },
  10: { ec: 26, sizes: [43, 43, 43, 43, 44] },
};

interface Decoded {
  text: string;
  mask: number;
  ecLevel: number;
  blocks: number[][];
}

function decode(matrix: { version: number; size: number; modules: Uint8Array }): Decoded {
  const { version, size, modules } = matrix;
  const at = (r: number, c: number): number => modules[r * size + c];

  // --- format string, from the copy around the top-left finder --------------
  let format = 0;
  const formatCells: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) formatCells.push([8, i]);
  formatCells.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) formatCells.push([14 - i, 8]);
  formatCells.forEach(([r, c], i) => { if (at(r, c)) format |= 1 << i; });
  format ^= 0x5412;
  const ecLevel = (format >> 13) & 0b11;
  const mask = (format >> 10) & 0b111;

  // --- codewords, read in the zig-zag order and unmasked --------------------
  const reserved = functionModules(version);
  const maskFn = MASKS[mask];
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (reserved[row][column]) continue;
        bits.push((at(row, column) === 1) !== maskFn(row, column) ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const spec = BLOCKS[version];
  const total = spec.sizes.reduce((a, b) => a + b, 0) + spec.sizes.length * spec.ec;
  const stream: number[] = [];
  for (let i = 0; i < total; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    stream.push(byte);
  }

  // --- de-interleave --------------------------------------------------------
  const dataBlocks: number[][] = spec.sizes.map(() => []);
  let at2 = 0;
  const longest = Math.max(...spec.sizes);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < spec.sizes.length; b++) {
      if (i < spec.sizes[b]) dataBlocks[b].push(stream[at2++]);
    }
  }
  const ecBlocks: number[][] = spec.sizes.map(() => []);
  for (let i = 0; i < spec.ec; i++) {
    for (let b = 0; b < spec.sizes.length; b++) ecBlocks[b].push(stream[at2++]);
  }

  // --- payload --------------------------------------------------------------
  const data = dataBlocks.flat();
  let cursor = 0;
  const take = (width: number): number => {
    let value = 0;
    for (let i = 0; i < width; i++, cursor++) {
      value = (value << 1) | ((data[cursor >> 3] >> (7 - (cursor & 7))) & 1);
    }
    return value;
  };
  const mode = take(4);
  expect(mode).toBe(0b0100); // byte mode
  const length = take(version < 10 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));

  return {
    text: new TextDecoder().decode(Uint8Array.from(bytes)),
    mask,
    ecLevel,
    blocks: dataBlocks.map((block, i) => [...block, ...ecBlocks[i]]),
  };
}

/** Every Reed-Solomon codeword is zero at the first `ec` powers of the root. */
function syndromesAreZero(codeword: number[], ec: number): boolean {
  for (let i = 0; i < ec; i++) {
    let sum = 0;
    for (let j = 0; j < codeword.length; j++) {
      sum ^= mul(codeword[j], exp[(i * (codeword.length - 1 - j)) % 255]);
    }
    if (sum !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const JOIN_URL = 'https://bible.example.org/present/v/K3M7QP2X';

describe('encoding', () => {
  it('round-trips a join URL', () => {
    const decoded = decode(encodeQr(JOIN_URL));
    expect(decoded.text).toBe(JOIN_URL);
  });

  it('round-trips at every version it supports', () => {
    // Lengths chosen to walk up the version table one step at a time; the point
    // is the version *change*, which is where the character-count width and the
    // block structure both move.
    for (const length of [4, 20, 34, 50, 70, 90, 110, 140, 170, 200]) {
      const text = 'A'.repeat(length);
      const matrix = encodeQr(text);
      expect(decode(matrix).text, `length ${length} at version ${matrix.version}`).toBe(text);
    }
  });

  it('picks the smallest version that fits', () => {
    // Version 1 at level M holds 16 data codewords: 1 mode nibble, an 8-bit
    // length, and 14 whole bytes with two bits to spare.
    expect(encodeQr('A'.repeat(14)).version).toBe(1);
    expect(encodeQr('A'.repeat(15)).version).toBe(2);
  });

  it('refuses more than it can encode rather than truncating', () => {
    expect(() => encodeQr('A'.repeat(MAX_QR_BYTES + 200))).toThrow(/Too much data/);
  });

  it('encodes non-ASCII as UTF-8', () => {
    const text = 'Iglesia — Génesis 1';
    expect(decode(encodeQr(text)).text).toBe(text);
  });
});

describe('error correction', () => {
  it('produces valid Reed-Solomon codewords in every block', () => {
    for (const length of [4, 34, 90, 140, 170, 200]) {
      const matrix = encodeQr('A'.repeat(length));
      const decoded = decode(matrix);
      const ec = BLOCKS[matrix.version].ec;
      decoded.blocks.forEach((block, i) => {
        expect(syndromesAreZero(block, ec), `version ${matrix.version}, block ${i}`).toBe(true);
      });
    }
  });
});

describe('the format and version strings', () => {
  it('matches the published format string for level M', () => {
    // The spec's own table: level M, mask 0.
    expect(formatBits(0).toString(2).padStart(15, '0')).toBe('101010000010010');
  });

  it('reports level M and the chosen mask back through the format string', () => {
    const decoded = decode(encodeQr(JOIN_URL));
    expect(decoded.ecLevel).toBe(0b00);
    expect(decoded.mask).toBeGreaterThanOrEqual(0);
    expect(decoded.mask).toBeLessThan(8);
  });

  it('carries version information from version 7 up', () => {
    // Read back the version string and check it names the version it is in.
    const matrix = encodeQr('A'.repeat(110));
    expect(matrix.version).toBeGreaterThanOrEqual(7);
    const { size, modules } = matrix;
    let bits = 0;
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      if (modules[r * size + (size - 11 + c)]) bits |= 1 << i;
    }
    expect(bits >> 12).toBe(matrix.version);
  });
});

describe('the matrix itself', () => {
  const matrix = encodeQr(JOIN_URL);
  const at = (r: number, c: number): number => matrix.modules[r * matrix.size + c];

  it('puts a finder pattern in three corners and not the fourth', () => {
    const centres = [[3, 3], [3, matrix.size - 4], [matrix.size - 4, 3]];
    for (const [r, c] of centres) {
      // Dark 3x3 core, light ring, dark ring.
      expect(at(r, c)).toBe(1);
      expect(at(r - 2, c)).toBe(0);
      expect(at(r - 3, c)).toBe(1);
    }
    // The bottom-right corner is data, and a finder there would break scanning.
    const corner = matrix.size - 4;
    const looksLikeFinder = at(corner, corner) === 1
      && at(corner - 2, corner) === 0 && at(corner - 3, corner) === 1;
    expect(looksLikeFinder).toBe(false);
  });

  it('alternates the timing patterns', () => {
    for (let i = 8; i < matrix.size - 8; i++) {
      expect(at(6, i), `row 6 column ${i}`).toBe(i % 2 === 0 ? 1 : 0);
      expect(at(i, 6), `column 6 row ${i}`).toBe(i % 2 === 0 ? 1 : 0);
    }
  });

  it('keeps the one permanently dark module dark', () => {
    expect(at(matrix.size - 8, 8)).toBe(1);
  });
});

describe('SVG output', () => {
  it('carries the quiet zone in the viewBox', () => {
    // Without it the code touches the edge of its box and stops scanning.
    const svg = qrSvg(JOIN_URL);
    const size = encodeQr(JOIN_URL).size;
    expect(svg).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
  });

  it('has no width or height, so it fills whatever box it is given', () => {
    // The <svg> element specifically -- the background rect inside it is sized
    // in viewBox units and has to be.
    const openingTag = qrSvg(JOIN_URL).match(/^<svg[^>]*>/)![0];
    expect(openingTag).not.toMatch(/\s(width|height)=/);
  });

  it('escapes a title rather than letting it close the tag', () => {
    const svg = qrSvg(JOIN_URL, { title: 'Join <b>now</b> & scan' });
    expect(svg).toContain('Join &#60;b&#62;now&#60;/b&#62; &#38; scan');
    expect(svg).not.toContain('<b>');
  });

  it('draws every dark module and no light ones', () => {
    // Count the modules the path covers and compare with the matrix, which
    // catches an off-by-one in the run-length encoding in either direction.
    const matrix = encodeQr(JOIN_URL);
    const runs = [...qrSvg(matrix.version === 0 ? '' : JOIN_URL)
      .matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    const dark = matrix.modules.reduce((sum, m) => sum + m, 0);
    expect(runs).toBe(dark);
  });
});
