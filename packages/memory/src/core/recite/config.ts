/**
 * Recite-aloud build constants and loop tuning.
 *
 * `BIAS_LEVEL` is a build-time decision (spike R0): how much of the expected
 * text is offered to the recogniser as a hint. 'names' (proper nouns and rare
 * names only, never in passage order) until the spike says otherwise.
 */

import type { BiasLevel } from '@bible/core/recite';
import type { ReciteSettings } from '../types';

export const BIAS_LEVEL: BiasLevel = 'names';

export const DEFAULT_RECITE_SETTINGS: ReciteSettings = {
  strictness: 'normal',
  promptStyle: 'reference',
  feedback: 'brief',
  readBack: true,
  autoAdvance: true,
  voiceCommands: true,
  hintDelayMs: 6000,
};

export const LOOP = {
  /** Nobody has spoken a matching word yet. */
  noSpeechStartMs: 8000,
  /** Listening cap: base plus per expected word, never more than the ceiling. */
  maxListenBaseMs: 30000,
  maxListenPerWordMs: 600,
  maxListenCeilingMs: 900000,
  /** Window for a spoken command after feedback (hands-free). */
  commandWindowMs: 3000,
  /** Words spoken in an opening prompt and in a pick-up hint. */
  openingWords: 3,
  pickUpWords: 3,
  /** Stall hints: 1 word, then this many. */
  hintWordsLater: 3,
  /** A stall this close to the end just scores. */
  nearEndWords: 3,
  /** Consecutive `lost` events before a pick-up hint. */
  lostLimit: 2,
  /** Speech-status cache. */
  probeCacheMs: 30000,
} as const;

export const SETTING_RECITE = 'reciteSettings';
