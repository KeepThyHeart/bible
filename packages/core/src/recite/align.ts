/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * Word alignment of a recitation against the expected passage.
 *
 * Weighted edit distance over words with joins (2..3 heard words for one
 * expected word) and splits (two expected words for one heard word). Pure and
 * deterministic; storage is typed arrays, banded for long passages.
 */

import { compareWords } from './compare';
import { foldTarget, tokenizeHeard } from './normalize';
import { scoreWords } from './policy';
import { applyTranspositions } from './transpose';
import type { WorkExtra, WorkWord } from './transpose';
import type {
  AlignedWord,
  HeardToken,
  ILanguageKit,
  RecitationResult,
  RecognizedWord,
  ScoringPolicy,
  WordVerdict,
} from './types';

const EPS = 1e-9;
const INS_COST = 0.6;
const DEL_COST = 1;
const BAND_THRESHOLD = 40000;
const BAND_BASE = 15;

const C_DIAG = 1;
const C_DEL = 2;
const C_INS = 3;
const C_JOIN2 = 4;
const C_JOIN3 = 5;
const C_SPLIT = 6;
const C_DELAND = 7;

export interface AlignOptions {
  hinted?: ReadonlySet<number>;
  /** Expected indices where each verse starts (first is 0). */
  verseStarts?: number[];
  /** `prefix`: trailing unmatched expected words are free (streaming, early stop). */
  mode?: 'full' | 'prefix';
  /** Testing: never band the DP, whatever the size. */
  unbanded?: boolean;
}

export type StepKind = 'diag' | 'del' | 'ins' | 'join' | 'split';

/** One move of the optimal path, in expected/heard token coordinates. */
export interface Step {
  kind: StepKind;
  /** Expected range [e0, e1). Empty for an insertion (e0 is where it sits). */
  e0: number;
  e1: number;
  /** Heard token range [h0, h1). Empty for a deletion. */
  h0: number;
  h1: number;
  /** Zero-cost deletion of an `and` inside a spoken number. */
  numberAnd?: boolean;
}

interface DpOptions {
  /** Expected words before the match are free (cursor search). */
  freeStart: boolean;
  /** Expected words after the match are free (prefix mode). */
  freeEnd: boolean;
  banded: boolean;
}

interface DpResult {
  steps: Step[];
  cost: number;
  /** Expected index where the path began / ended. */
  startI: number;
  endI: number;
}

type Cmp = ReturnType<typeof compareWords>;
type CmpCache = Map<string, Cmp>;

function isExact(v: string): boolean {
  return v === 'correct' || v === 'variant';
}

function runDp(
  E: readonly string[],
  H: readonly HeardToken[],
  kit: ILanguageKit,
  cache: CmpCache,
  o: DpOptions,
): DpResult {
  const n = E.length;
  const m = H.length;
  const W = m + 1;
  const D = new Float64Array((n + 1) * W).fill(Infinity);
  const B = new Uint8Array((n + 1) * W);
  D[0] = 0;
  const hw = BAND_BASE + Math.abs(n - m);

  const cmp = (ei: number, hj: number): Cmp => compareWords(E[ei], H[hj].norm, kit, cache);
  const cmpJoin = (ei: number, h0: number, h1: number): Cmp => {
    let s = '';
    for (let k = h0; k < h1; k++) s += H[k].norm;
    const r = compareWords(E[ei], s, kit, cache);
    if (r.verdict === 'near') {
      // A near join is only a join when no piece is the word by itself
      // ("very beginning" is an extra word, not a join).
      for (let k = h0; k < h1; k++) {
        if (isExact(compareWords(E[ei], H[k].norm, kit, cache).verdict)) return { verdict: 'wrong', cost: 1 } as Cmp;
      }
    }
    return r;
  };

  for (let i = 0; i <= n; i++) {
    let jLo = 0;
    let jHi = m;
    if (o.banded && n > 0) {
      const c = (i * m) / n;
      jLo = Math.max(0, Math.floor(c - hw));
      jHi = Math.min(m, Math.ceil(c + hw));
    }
    for (let j = jLo; j <= jHi; j++) {
      if (i === 0 && j === 0) continue;
      const idx = i * W + j;
      if (j === 0 && o.freeStart) {
        D[idx] = 0;
        continue;
      }
      let best = Infinity;
      let code = 0;
      // Priority order (ties keep the earlier candidate): deletion, exact
      // diagonal, join/split, near/wrong diagonal, insertion. Preferring the
      // deletion at a tie matches the earlier of two repeated words.
      if (i > 0) {
        const prev = D[(i - 1) * W + j];
        if (prev < Infinity) {
          const numberAnd =
            E[i - 1] === 'and' && j >= 1 && j < m && !!H[j - 1].fromNumber && !!H[j].fromNumber;
          const v = prev + (numberAnd ? 0 : DEL_COST);
          if (v < best - EPS) {
            best = v;
            code = numberAnd ? C_DELAND : C_DEL;
          }
        }
      }
      let diagNear: number | null = null;
      if (i > 0 && j > 0) {
        const prev = D[(i - 1) * W + (j - 1)];
        if (prev < Infinity) {
          const r = cmp(i - 1, j - 1);
          const v = prev + r.cost;
          if (isExact(r.verdict)) {
            if (v < best - EPS) {
              best = v;
              code = C_DIAG;
            }
          } else {
            diagNear = v;
          }
        }
      }
      if (i > 0 && j >= 2) {
        const prev = D[(i - 1) * W + (j - 2)];
        if (prev < Infinity) {
          const r = cmpJoin(i - 1, j - 2, j);
          if (r.verdict !== 'wrong') {
            const v = prev + r.cost;
            if (v < best - EPS) {
              best = v;
              code = C_JOIN2;
            }
          }
        }
      }
      if (i > 0 && j >= 3) {
        const prev = D[(i - 1) * W + (j - 3)];
        if (prev < Infinity) {
          const r = cmpJoin(i - 1, j - 3, j);
          if (r.verdict !== 'wrong') {
            const v = prev + r.cost;
            if (v < best - EPS) {
              best = v;
              code = C_JOIN3;
            }
          }
        }
      }
      if (i > 1 && j > 0) {
        const prev = D[(i - 2) * W + (j - 1)];
        if (prev < Infinity) {
          const r = compareWords(E[i - 2] + E[i - 1], H[j - 1].norm, kit, cache);
          if (isExact(r.verdict)) {
            const v = prev + r.cost;
            if (v < best - EPS) {
              best = v;
              code = C_SPLIT;
            }
          }
        }
      }
      if (diagNear !== null && diagNear < best - EPS) {
        best = diagNear;
        code = C_DIAG;
      }
      if (j > 0) {
        const prev = D[i * W + (j - 1)];
        if (prev < Infinity) {
          const v = prev + INS_COST;
          if (v < best - EPS) {
            best = v;
            code = C_INS;
          }
        }
      }
      D[idx] = best;
      B[idx] = code;
    }
  }

  // End cell.
  let endI = n;
  if (o.freeEnd) {
    let bestV = Infinity;
    endI = -1;
    for (let i = 0; i <= n; i++) {
      const v = D[i * W + m];
      if (v < bestV - EPS) {
        bestV = v;
        endI = i;
      }
    }
    if (endI < 0) return { steps: [], cost: Infinity, startI: 0, endI: 0 };
  }
  const total = D[endI * W + m];
  if (total === Infinity) return { steps: [], cost: Infinity, startI: 0, endI };

  const steps: Step[] = [];
  let i = endI;
  let j = m;
  while (!(i === 0 && j === 0)) {
    if (o.freeStart && j === 0) break;
    const code = B[i * W + j];
    if (code === C_DIAG) {
      steps.push({ kind: 'diag', e0: i - 1, e1: i, h0: j - 1, h1: j });
      i--;
      j--;
    } else if (code === C_DEL || code === C_DELAND) {
      steps.push({ kind: 'del', e0: i - 1, e1: i, h0: j, h1: j, numberAnd: code === C_DELAND });
      i--;
    } else if (code === C_INS) {
      steps.push({ kind: 'ins', e0: i, e1: i, h0: j - 1, h1: j });
      j--;
    } else if (code === C_JOIN2 || code === C_JOIN3) {
      const k = code === C_JOIN2 ? 2 : 3;
      steps.push({ kind: 'join', e0: i - 1, e1: i, h0: j - k, h1: j });
      i--;
      j -= k;
    } else if (code === C_SPLIT) {
      steps.push({ kind: 'split', e0: i - 2, e1: i, h0: j - 1, h1: j });
      i -= 2;
      j--;
    } else {
      break;
    }
  }
  steps.reverse();
  return { steps, cost: total, startI: i, endI };
}

function alignTokens(
  E: readonly string[],
  H: readonly HeardToken[],
  kit: ILanguageKit,
  cache: CmpCache,
  o: { freeStart: boolean; freeEnd: boolean; unbanded?: boolean },
): DpResult {
  const banded = !o.unbanded && !o.freeStart && !o.freeEnd && E.length * H.length > BAND_THRESHOLD;
  if (banded) {
    const r = runDp(E, H, kit, cache, { freeStart: o.freeStart, freeEnd: o.freeEnd, banded: true });
    if (r.cost !== Infinity) return r;
  }
  return runDp(E, H, kit, cache, { freeStart: o.freeStart, freeEnd: o.freeEnd, banded: false });
}

/** Tokenise the heard side: fillers dropped, digits expanded, whole-utterance commands ignored. */
export function heardTokens(heard: RecognizedWord[], kit: ILanguageKit): HeardToken[] {
  const toks = tokenizeHeard(heard, kit).filter((t) => !kit.fillers.has(t.norm));
  if (toks.length > 0) {
    const phrase = toks.map((t) => t.norm).join(' ');
    if (Object.prototype.hasOwnProperty.call(kit.commands, phrase)) return [];
  }
  return toks;
}

export function foldExpected(expected: readonly string[]): string[] {
  return expected.map((w) => {
    const f = foldTarget(w);
    return f.length > 0 ? f : w.toLowerCase();
  });
}

function minConf(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a < b ? a : b;
}

/** Convert the optimal path into per-word verdicts and extras. */
function stepsToWords(
  E: readonly string[],
  H: readonly HeardToken[],
  steps: readonly Step[],
  kit: ILanguageKit,
  cache: CmpCache,
): { words: WorkWord[]; extras: WorkExtra[] } {
  const n = E.length;
  const words: WorkWord[] = [];
  for (let i = 0; i < n; i++) words.push({ index: i, verdict: 'missed', credit: 0 });
  const extras: WorkExtra[] = [];
  for (const s of steps) {
    if (s.kind === 'ins') {
      const t = H[s.h0];
      extras.push({ afterIndex: s.e0 - 1, heard: t.text, tok: s.h0, norm: t.norm });
    } else if (s.kind === 'del') {
      if (s.numberAnd) words[s.e0].verdict = 'variant';
    } else if (s.kind === 'diag') {
      const t = H[s.h0];
      const r = compareWords(E[s.e0], t.norm, kit, cache);
      const w = words[s.e0];
      w.verdict = r.verdict as WordVerdict;
      w.heard = t.text;
      w.heardIndex = t.heardIndex;
      w.tok = s.h0;
      w.conf = t.confidence;
    } else if (s.kind === 'join') {
      let norm = '';
      const texts: string[] = [];
      let conf: number | undefined;
      for (let k = s.h0; k < s.h1; k++) {
        norm += H[k].norm;
        texts.push(H[k].text);
        conf = minConf(conf, H[k].confidence);
      }
      const r = compareWords(E[s.e0], norm, kit, cache);
      const w = words[s.e0];
      w.verdict = r.verdict as WordVerdict;
      w.heard = texts.join(' ');
      w.heardIndex = H[s.h0].heardIndex;
      w.tok = s.h0;
      w.conf = conf;
    } else {
      const t = H[s.h0];
      const r = compareWords(E[s.e0] + E[s.e0 + 1], t.norm, kit, cache);
      for (let e = s.e0; e < s.e1; e++) {
        const w = words[e];
        w.verdict = r.verdict as WordVerdict;
        w.heard = t.text;
        w.heardIndex = t.heardIndex;
        w.tok = s.h0;
        w.conf = t.confidence;
      }
    }
  }
  return { words, extras };
}

function publicWord(w: WorkWord): AlignedWord {
  const out: AlignedWord = { index: w.index, verdict: w.verdict, credit: w.credit };
  if (w.heard !== undefined) out.heard = w.heard;
  if (w.heardIndex !== undefined) out.heardIndex = w.heardIndex;
  return out;
}

export function alignRecitation(
  expected: string[],
  heard: RecognizedWord[],
  kit: ILanguageKit,
  policy: ScoringPolicy,
  opts?: AlignOptions,
): RecitationResult {
  const n = expected.length;
  if (n === 0) return { words: [], extras: [], score: 0, verseScores: [], lastMatched: -1 };
  const prefix = opts !== undefined && opts.mode === 'prefix';
  const E = foldExpected(expected);
  const H = heardTokens(heard, kit);
  const cache: CmpCache = new Map();

  const dp = alignTokens(E, H, kit, cache, {
    freeStart: false,
    freeEnd: prefix,
    unbanded: opts !== undefined && opts.unbanded === true,
  });
  const built = stepsToWords(E, H, dp.steps, kit, cache);
  const words = built.words;
  const extras = applyTranspositions(words, built.extras, E, H, kit);

  const hinted = opts !== undefined ? opts.hinted : undefined;
  const strict = policy.strictness === 'strict';
  for (const w of words) {
    if (hinted !== undefined && hinted.has(w.index)) {
      w.verdict = 'hinted';
    } else if (
      w.verdict === 'near' &&
      !strict &&
      w.conf !== undefined &&
      w.conf < policy.lowConfidence
    ) {
      w.verdict = 'variant';
    }
    w.credit = policy.credit[w.verdict];
  }

  let lastMatched = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (words[i].verdict !== 'missed') {
      lastMatched = i;
      break;
    }
  }

  const score = scoreWords(words, extras.length, policy);
  const verseScores = scoreVerses(words, extras, policy, opts !== undefined ? opts.verseStarts : undefined);
  return {
    words: words.map(publicWord),
    extras: extras.map((x) => ({ afterIndex: x.afterIndex, heard: x.heard })),
    score,
    verseScores,
    lastMatched,
  };
}

function scoreVerses(
  words: readonly WorkWord[],
  extras: readonly WorkExtra[],
  policy: ScoringPolicy,
  verseStarts: number[] | undefined,
): number[] {
  const n = words.length;
  const starts = verseStarts && verseStarts.length > 0 ? verseStarts : [0];
  const out: number[] = [];
  for (let k = 0; k < starts.length; k++) {
    const a = Math.max(0, Math.min(n, starts[k]));
    const b = k + 1 < starts.length ? Math.max(a, Math.min(n, starts[k + 1])) : n;
    let count = 0;
    for (const x of extras) {
      const at = Math.max(0, x.afterIndex);
      // The first verse also owns extras before word 0.
      if (at >= a && at < b) count++;
    }
    out.push(scoreWords(words.slice(a, b), count, policy));
  }
  return out;
}

/** Result of a semi-global search used by the streaming cursor. */
export interface SegmentMatch {
  /** Expected index of the first / last matched word; -1 if nothing matched. */
  start: number;
  end: number;
  /** Heard tokens consumed by matched steps. */
  matchedTokens: number;
  cost: number;
}

/** Find where `heard` best sits inside `expected` (free start and end). */
export function locateSegment(
  expected: readonly string[],
  heard: readonly HeardToken[],
  kit: ILanguageKit,
): SegmentMatch {
  const none: SegmentMatch = { start: -1, end: -1, matchedTokens: 0, cost: Infinity };
  if (expected.length === 0 || heard.length === 0) return none;
  const cache: CmpCache = new Map();
  const dp = alignTokens(expected, heard, kit, cache, { freeStart: true, freeEnd: true });
  if (dp.cost === Infinity) return none;
  let start = -1;
  let end = -1;
  let matched = 0;
  for (const s of dp.steps) {
    if (s.kind === 'ins' || s.kind === 'del') continue;
    if (s.kind === 'diag' && compareWords(expected[s.e0], heard[s.h0].norm, kit, cache).verdict === 'wrong') {
      continue;
    }
    if (start < 0) start = s.e0;
    end = s.e1 - 1;
    matched += s.h1 - s.h0;
  }
  return { start, end, matchedTokens: matched, cost: dp.cost };
}
