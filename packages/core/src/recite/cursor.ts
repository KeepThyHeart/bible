/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * Streaming cursor: follows a learner through the passage chunk by chunk and
 * reports flow events (on track, jumped, went back, lost). It drives the
 * hands-free loop only; the final score is always a full `alignRecitation`
 * over `heard`.
 */

import { alignRecitation, foldExpected, heardTokens, locateSegment } from './align';
import { compareWords } from './compare';
import { tokenizeHeard } from './normalize';
import { POLICIES } from './policy';
import type { LoopCommand, ILanguageKit, RecognizedWord } from './types';

export type CursorEvent =
  | { kind: 'command'; command: LoopCommand }
  | { kind: 'on-track'; position: number }
  | { kind: 'jumped-ahead'; from: number; to: number }
  | { kind: 'went-back'; to: number }
  | { kind: 'lost' }
  | { kind: 'uncertain' };

const ON_TRACK_RATIO = 0.6;
const SEARCH_RATIO = 0.5;
const START_SLACK = 3;
const JUMP_SLACK = 4;
const MIN_CONTENT_WORDS = 3;

export class ReciteCursor {
  /** Last matched expected index, -1 at start. */
  position = -1;
  /** Furthest expected index ever matched. */
  furthest = -1;
  /** Every non-command chunk, in memory only. */
  heard: RecognizedWord[] = [];

  private readonly expected: string[];
  private readonly windowExtra: number;
  private lastHeardNorm = '';
  private readonly cache = new Map();

  constructor(
    expected: string[],
    private readonly kit: ILanguageKit,
    opts?: { window?: number },
  ) {
    this.expected = foldExpected(expected);
    this.windowExtra = opts !== undefined && opts.window !== undefined ? opts.window : 10;
  }

  get isComplete(): boolean {
    const n = this.expected.length;
    if (n === 0) return false;
    if (this.furthest >= n - 1) return true;
    if (this.furthest >= n - 2 && this.lastHeardNorm !== '') {
      const r = compareWords(this.expected[n - 1], this.lastHeardNorm, this.kit, this.cache);
      return r.verdict === 'near';
    }
    return false;
  }

  push(chunk: RecognizedWord[]): CursorEvent {
    const tokens = heardTokens(chunk, this.kit);

    // Whole-chunk command phrase.
    const phrase = this.commandPhrase(chunk);
    if (phrase !== null) return { kind: 'command', command: phrase };

    this.heard.push(...chunk);
    if (tokens.length === 0) return { kind: 'uncertain' };
    this.lastHeardNorm = tokens[tokens.length - 1].norm;

    const n = this.expected.length;
    const from = this.position;
    const winStart = this.position + 1;
    if (winStart >= n) return { kind: 'on-track', position: this.position };

    // 1. On track: prefix alignment against the window after the position.
    const winLen = 2 * tokens.length + this.windowExtra;
    const win = this.expected.slice(winStart, winStart + winLen);
    const res = alignRecitation(win, chunk, this.kit, POLICIES.normal, { mode: 'prefix' });
    let matched = 0;
    let first = -1;
    let last = -1;
    for (const w of res.words) {
      if (w.verdict === 'missed' || w.verdict === 'wrong' || w.verdict === 'hinted') continue;
      matched++;
      if (first < 0) first = w.index;
      last = w.index;
    }
    if (first >= 0 && first <= START_SLACK && Math.min(1, matched / tokens.length) >= ON_TRACK_RATIO) {
      return this.advance(winStart + last);
    }

    // Short chunks never derail.
    if (tokens.length < MIN_CONTENT_WORDS) return { kind: 'uncertain' };

    // 2. Search the whole passage.
    const seg = locateSegment(this.expected, tokens, this.kit);
    if (seg.start < 0 || seg.matchedTokens / tokens.length < SEARCH_RATIO) return { kind: 'lost' };
    if (seg.start > from + JUMP_SLACK) {
      this.position = seg.end;
      if (seg.end > this.furthest) this.furthest = seg.end;
      return { kind: 'jumped-ahead', from, to: seg.end };
    }
    if (seg.start <= from) {
      this.position = seg.end;
      return { kind: 'went-back', to: seg.end };
    }
    return this.advance(seg.end);
  }

  private advance(to: number): CursorEvent {
    this.position = to;
    if (to > this.furthest) this.furthest = to;
    return { kind: 'on-track', position: to };
  }

  private commandPhrase(chunk: RecognizedWord[]): LoopCommand | null {
    const raw = tokenizeHeard(chunk, this.kit)
      .filter((t) => !this.kit.fillers.has(t.norm))
      .map((t) => t.norm)
      .join(' ');
    if (raw === '') return null;
    const cmds = this.kit.commands;
    return Object.prototype.hasOwnProperty.call(cmds, raw) ? cmds[raw] : null;
  }
}
