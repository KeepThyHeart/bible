/**
 * A QR encoder, sized for one job: putting a join URL on a screen so a room
 * full of people can point a camera at it instead of typing an eight-character
 * code into a phone browser.
 *
 * Written here rather than pulled from npm for the same reason this app
 * self-hosts its fonts, its embedding model and the ONNX runtime: the machine
 * driving a television in a church hall may have no usable internet, and a
 * feature whose whole purpose is "get people connected" must not have a
 * third-party dependency in its path. It is also, at this scope, small.
 *
 * The scope is deliberately narrow, and everything below follows from it:
 *
 *  - **Byte mode only.** The payload is a URL. Alphanumeric mode would encode
 *    an uppercase URL more densely, but only by making the encoder decide
 *    between modes, and the codes here are far from any capacity limit.
 *  - **Error correction level M** (~15%). Level L scans no better in practice
 *    on a bright screen and leaves less margin for a camera at the back of a
 *    hall; level Q and H buy margin nobody needs at these lengths and make the
 *    code denser, which is the thing that actually hurts at distance.
 *  - **Versions 1-10**, up to 216 bytes. A join URL is roughly forty
 *    characters. Anything approaching this limit is not a URL and should be
 *    rejected rather than silently encoded into a code no camera can read.
 *
 * Reference: ISO/IEC 18004. The tables below are transcribed from it; the
 * arithmetic is derived rather than transcribed, and the tests check both --
 * every block's Reed-Solomon syndromes are verified to be zero using GF tables
 * built independently of these, and a decoder reads the finished matrix back.
 */

// ---------------------------------------------------------------------------
// Tables (ISO/IEC 18004, error correction level M)
// ---------------------------------------------------------------------------

interface VersionSpec {
  /** Data codewords in total, across every block. */
  dataCodewords: number;
  /** Error correction codewords per block. */
  ecPerBlock: number;
  /** Blocks in group 1, and data codewords in each. */
  group1: [blocks: number, size: number];
  /** Blocks in group 2, one codeword longer than group 1. Absent when unused. */
  group2?: [blocks: number, size: number];
  /** Row/column centres of the alignment patterns. Empty for version 1. */
  alignment: number[];
}

const VERSIONS: readonly VersionSpec[] = [
  { dataCodewords: 16, ecPerBlock: 10, group1: [1, 16], alignment: [] },
  { dataCodewords: 28, ecPerBlock: 16, group1: [1, 28], alignment: [6, 18] },
  { dataCodewords: 44, ecPerBlock: 26, group1: [1, 44], alignment: [6, 22] },
  { dataCodewords: 64, ecPerBlock: 18, group1: [2, 32], alignment: [6, 26] },
  { dataCodewords: 86, ecPerBlock: 24, group1: [2, 43], alignment: [6, 30] },
  { dataCodewords: 108, ecPerBlock: 16, group1: [4, 27], alignment: [6, 34] },
  { dataCodewords: 124, ecPerBlock: 18, group1: [4, 31], alignment: [6, 22, 38] },
  { dataCodewords: 154, ecPerBlock: 22, group1: [2, 38], group2: [2, 39], alignment: [6, 24, 42] },
  { dataCodewords: 182, ecPerBlock: 22, group1: [3, 36], group2: [2, 37], alignment: [6, 26, 46] },
  { dataCodewords: 216, ecPerBlock: 26, group1: [4, 43], group2: [1, 44], alignment: [6, 28, 50] },
];

/** Error correction level M, as the two bits that go into the format string. */
const EC_LEVEL_BITS = 0b00;

export const MAX_QR_BYTES = VERSIONS[VERSIONS.length - 1].dataCodewords - 3;

// ---------------------------------------------------------------------------
// GF(256)
// ---------------------------------------------------------------------------

/**
 * The Galois field QR arithmetic lives in: byte values under a multiplication
 * that never overflows, with 0x11D as the reducing polynomial.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  // Doubled so a product of two logs can be read without a modulo.
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/**
 * The generator polynomial for `degree` error correction codewords: the product
 * of (x - a^i) for i below the degree, with coefficients highest-power-first.
 */
function generatorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The remainder of the message divided by the generator: the EC codewords. */
function errorCorrection(data: Uint8Array, ecLength: number): Uint8Array {
  const generator = generatorPoly(ecLength);
  const remainder = new Uint8Array(ecLength);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecLength - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecLength; i++) {
        remainder[i] ^= gfMul(generator[i + 1], factor);
      }
    }
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// BCH, for the format and version information
// ---------------------------------------------------------------------------

/** Remainder of `value` under `generator`, both read as bit polynomials. */
function bch(value: number, generator: number, bits: number): number {
  let remainder = value;
  const generatorBits = 32 - Math.clz32(generator);
  while (32 - Math.clz32(remainder) >= generatorBits) {
    remainder ^= generator << (32 - Math.clz32(remainder) - generatorBits);
  }
  return remainder & ((1 << bits) - 1);
}

/**
 * The 15-bit format string: two bits of EC level, three of mask, ten of BCH,
 * masked with 0x5412 so an all-zero format is not a valid one.
 */
export function formatBits(mask: number): number {
  const data = (EC_LEVEL_BITS << 3) | mask;
  return ((data << 10) | bch(data << 10, 0x537, 10)) ^ 0x5412;
}

/** The 18-bit version string, present only from version 7 up. */
function versionBits(version: number): number {
  return (version << 12) | bch(version << 12, 0x1f25, 12);
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

/** A finished code: a square of modules, plus the version it came out at. */
export interface QrMatrix {
  version: number;
  size: number;
  /** True where the module is dark. Indexed `[row * size + column]`. */
  modules: Uint8Array;
  mask: number;
}

class Grid {
  readonly size: number;
  readonly modules: Uint8Array;
  /** Function patterns, which data must skip and masking must leave alone. */
  readonly reserved: Uint8Array;

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = new Uint8Array(this.size * this.size);
    this.reserved = new Uint8Array(this.size * this.size);
  }

  set(row: number, column: number, dark: boolean, reserve = true): void {
    if (row < 0 || column < 0 || row >= this.size || column >= this.size) return;
    this.modules[row * this.size + column] = dark ? 1 : 0;
    if (reserve) this.reserved[row * this.size + column] = 1;
  }

  isReserved(row: number, column: number): boolean {
    return this.reserved[row * this.size + column] === 1;
  }

  clone(): Grid {
    const copy = new Grid(this.version);
    copy.modules.set(this.modules);
    copy.reserved.set(this.reserved);
    return copy;
  }
}

/** Finder patterns, separators, timing, alignment, and the lone dark module. */
function drawFunctionPatterns(grid: Grid): void {
  const last = grid.size - 7;

  for (const [top, left] of [[0, 0], [0, last], [last, 0]] as const) {
    // The 7x7 finder, its 1-module light ring, and the separator around it.
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const ring = Math.max(Math.abs(dy - 3), Math.abs(dx - 3));
        grid.set(top + dy, left + dx, ring !== 2 && ring <= 3);
      }
    }
  }

  // Timing: alternating modules along row 6 and column 6, between the finders.
  for (let i = 8; i < grid.size - 8; i++) {
    const dark = i % 2 === 0;
    grid.set(6, i, dark);
    grid.set(i, 6, dark);
  }

  // Alignment patterns, except where one would collide with a finder.
  const centres = VERSIONS[grid.version - 1].alignment;
  for (const row of centres) {
    for (const column of centres) {
      const nearFinder = (row === 6 && column === 6)
        || (row === 6 && column === grid.size - 7)
        || (row === grid.size - 7 && column === 6);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          grid.set(row + dy, column + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1);
        }
      }
    }
  }

  // Reserve the format areas so data placement steps over them. Their contents
  // are written after a mask has been chosen. Row and column 6 are skipped:
  // those two modules belong to the timing patterns, which are already drawn
  // and must not be flattened here.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) grid.set(8, i, false);
    if (i !== 6) grid.set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    grid.set(8, grid.size - 1 - i, false);
    grid.set(grid.size - 1 - i, 8, false);
  }

  // Always dark, and the only module of its kind. Written after the reservation
  // above, which covers the same module and would otherwise clear it.
  grid.set(grid.size - 8, 8, true);

  if (grid.version >= 7) {
    for (let i = 0; i < 18; i++) {
      const row = Math.floor(i / 3);
      const column = i % 3;
      grid.set(row, grid.size - 11 + column, false);
      grid.set(grid.size - 11 + column, row, false);
    }
  }
}

function drawVersionInfo(grid: Grid): void {
  if (grid.version < 7) return;
  const bits = versionBits(grid.version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const column = i % 3;
    grid.set(row, grid.size - 11 + column, dark);
    grid.set(grid.size - 11 + column, row, dark);
  }
}

/**
 * Write the format string twice: once wrapped around the top-left finder, once
 * split between the other two. A scanner that cannot read one copy -- a torn
 * corner, a thumb over the code -- still gets the mask and EC level from the
 * other, which is why it is duplicated rather than merely error-corrected.
 */
function drawFormatInfo(grid: Grid, mask: number): void {
  const bits = formatBits(mask);
  const bit = (i: number): boolean => ((bits >> i) & 1) === 1;
  const last = grid.size - 1;

  // Copy one, anticlockwise from (8,0), stepping over the timing modules at
  // row 6 and column 6.
  for (let i = 0; i < 6; i++) grid.set(8, i, bit(i));
  grid.set(8, 7, bit(6));
  grid.set(8, 8, bit(7));
  grid.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(i));

  // Copy two: seven modules up the bottom-left finder, eight along the top
  // right. The module below the seventh is the permanently dark one, not part
  // of the format string.
  for (let i = 0; i < 7; i++) grid.set(last - i, 8, bit(i));
  for (let i = 7; i < 15; i++) grid.set(8, grid.size - 15 + i, bit(i));
}

const MASKS: ReadonlyArray<(row: number, column: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/**
 * Lay the codeword bits into the matrix, masked, in the standard order: upward
 * and downward through pairs of columns from the right, skipping the vertical
 * timing column.
 */
function placeData(grid: Grid, codewords: Uint8Array, mask: number): void {
  const maskFn = MASKS[mask];
  let bit = 0;
  let upward = true;

  for (let right = grid.size - 1; right >= 1; right -= 2) {
    // Column 6 is the timing pattern; the pairs step over it entirely.
    if (right === 6) right = 5;

    for (let step = 0; step < grid.size; step++) {
      const row = upward ? grid.size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (grid.isReserved(row, column)) continue;

        // Past the end of the data, the remainder bits are zero -- but still
        // masked, which is what makes them indistinguishable from data.
        const value = bit < codewords.length * 8
          ? (codewords[bit >> 3] >> (7 - (bit & 7))) & 1
          : 0;
        bit++;
        grid.set(row, column, (value === 1) !== maskFn(row, column), false);
      }
    }
    upward = !upward;
  }
}

// ---------------------------------------------------------------------------
// Mask selection
// ---------------------------------------------------------------------------

/**
 * The four penalty rules from the spec. Lower is better; the winning mask is
 * the one that leaves the fewest features a scanner could mistake for a finder
 * pattern or lose its place in.
 */
function penalty(grid: Grid): number {
  const { size, modules } = grid;
  const at = (r: number, c: number): number => modules[r * size + c];
  let score = 0;

  // Rule 1: runs of five or more identical modules, in both directions.
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const current = horizontal ? at(i, j) : at(j, i);
        const previous = horizontal ? at(i, j - 1) : at(j - 1, i);
        if (current === previous) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
      }
    }
  }

  // Rule 2: every 2x2 block of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }

  // Rule 3: the 1:1:3:1:1 finder-like pattern with four light modules beside it.
  const patterns = [
    [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  ];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= size - 11; j++) {
      for (const pattern of patterns) {
        let horizontal = true;
        let vertical = true;
        for (let k = 0; k < 11; k++) {
          if (at(i, j + k) !== pattern[k]) horizontal = false;
          if (at(j + k, i) !== pattern[k]) vertical = false;
        }
        if (horizontal) score += 40;
        if (vertical) score += 40;
      }
    }
  }

  // Rule 4: how far the proportion of dark modules strays from half.
  let dark = 0;
  for (const module of modules) dark += module;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Character count indicator width, which grows at version 10 in byte mode. */
function countBits(version: number): number {
  return version < 10 ? 8 : 16;
}

function chooseVersion(byteLength: number): number {
  for (let version = 1; version <= VERSIONS.length; version++) {
    const needed = 4 + countBits(version) + byteLength * 8;
    if (needed <= VERSIONS[version - 1].dataCodewords * 8) return version;
  }
  throw new Error(`Too much data for a QR code: ${byteLength} bytes`);
}

/** Mode indicator, length, payload, terminator and padding, as whole bytes. */
function buildDataCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const spec = VERSIONS[version - 1];
  const out = new Uint8Array(spec.dataCodewords);
  let bit = 0;

  const push = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i--) {
      if ((value >> i) & 1) out[bit >> 3] |= 0x80 >> (bit & 7);
      bit++;
    }
  };

  push(0b0100, 4);                       // byte mode
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);

  // Terminator: up to four zero bits, then round up to a whole byte. Both are
  // already zero in `out`, so this is only a matter of moving the cursor.
  bit = Math.min(bit + 4, spec.dataCodewords * 8);
  bit = Math.ceil(bit / 8) * 8;

  // The two prescribed pad bytes, alternating, to the end of the capacity.
  for (let i = bit >> 3, alternate = 0; i < spec.dataCodewords; i++, alternate ^= 1) {
    out[i] = alternate === 0 ? 0xec : 0x11;
  }
  return out;
}

/**
 * Split into blocks, compute each block's EC codewords, and interleave both --
 * the interleaving is what makes a scratch across the code damage a few
 * codewords in every block rather than destroying one block completely.
 */
function interleave(data: Uint8Array, version: number): Uint8Array {
  const spec = VERSIONS[version - 1];
  const groups: Array<[blocks: number, size: number]> = spec.group2
    ? [spec.group1, spec.group2]
    : [spec.group1];

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const [blocks, size] of groups) {
    for (let i = 0; i < blocks; i++) {
      const block = data.subarray(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(errorCorrection(block, spec.ecPerBlock));
    }
  }

  const out = new Uint8Array(data.length + ecBlocks.length * spec.ecPerBlock);
  let at = 0;
  const longest = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out[at++] = block[i];
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) out[at++] = block[i];
  }
  return out;
}

/** Encode `text` (UTF-8) into a finished, masked matrix. */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const codewords = interleave(buildDataCodewords(bytes, version), version);

  const base = new Grid(version);
  drawFunctionPatterns(base);
  drawVersionInfo(base);

  // Every mask is tried in full. There is no shortcut that picks the right one
  // from the data, and at this size the eight passes are microseconds.
  let best: Grid | null = null;
  let bestScore = Infinity;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = base.clone();
    placeData(candidate, codewords, mask);
    drawFormatInfo(candidate, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
      bestMask = mask;
    }
  }

  const grid = best!;
  return { version, size: grid.size, modules: grid.modules, mask: bestMask };
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

export interface QrSvgOptions {
  /** Light margin around the code, in modules. Four is the specified minimum. */
  quietZone?: number;
  dark?: string;
  light?: string;
  /** Accessible name. Omitted entirely when not given. */
  title?: string;
}

/**
 * Render a matrix as an SVG string.
 *
 * One `<path>` of horizontal runs rather than a rect per module: a version 4
 * code is around 900 dark modules, and the run-length form is several times
 * smaller with no rendering difference. The image carries no width or height so
 * it scales to whatever box it is placed in, and `shape-rendering="crispEdges"`
 * stops a browser antialiasing module edges into grey -- which is what makes a
 * scaled-up code fail to scan.
 */
export function qrSvg(text: string, options: QrSvgOptions = {}): string {
  const { size, modules } = encodeQr(text);
  const quiet = options.quietZone ?? 4;
  const extent = size + quiet * 2;

  const runs: string[] = [];
  for (let row = 0; row < size; row++) {
    let start = -1;
    for (let column = 0; column <= size; column++) {
      const dark = column < size && modules[row * size + column] === 1;
      if (dark && start < 0) start = column;
      if (!dark && start >= 0) {
        runs.push(`M${start + quiet} ${row + quiet}h${column - start}v1h-${column - start}z`);
        start = -1;
      }
    }
  }

  const title = options.title
    ? `<title>${options.title.replace(/[<>&]/g, ch => `&#${ch.charCodeAt(0)};`)}</title>`
    : '';

  return '<svg xmlns="http://www.w3.org/2000/svg" '
    + `viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges"`
    + `${options.title ? ' role="img"' : ' aria-hidden="true"'}>`
    + title
    + `<rect width="${extent}" height="${extent}" fill="${options.light ?? '#ffffff'}"/>`
    + `<path fill="${options.dark ?? '#000000'}" d="${runs.join('')}"/>`
    + '</svg>';
}
