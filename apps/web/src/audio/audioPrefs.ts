/**
 * The listener's audio preferences: what is stored, how it is validated, and
 * how the speed actually used is derived from the wish.
 *
 * Stored under its own key, separate from `settingsStore`, so resetting the
 * reading settings does not wipe them and so this file has no dependencies. A
 * stored value is a wish, never trusted: every field is validated on load and a
 * bad one falls back to its default, so a hand-edited or older payload can never
 * put the feature in a state the UI cannot represent.
 */

import type { AudioCapabilities, AudioPrefs, AudioSourceChoice } from '@bible/core/browser';

export const AUDIO_PREFS_KEY = 'bible-audio-prefs';
const VERSION = 1;

/** Speed limits that hold whatever the provider (providers narrow this further). */
export const GLOBAL_RATE = { min: 0.5, max: 2 } as const;

const MAX_PER_TRANSLATION = 200;
const SOURCE_PATTERN = /^(auto|recorded|tts:[a-z0-9_-]+)$/;

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  source: 'auto',
  perTranslation: {},
  voiceByEngineLang: {},
  rate: 1,
  followAlong: true,
  autoScroll: true,
  continueAfterChapter: 'next-chapter',
  readChapterIntro: true,
  phoneBatteryNoticeSeen: {},
};

export function defaultAudioPrefs(): AudioPrefs {
  return {
    ...DEFAULT_AUDIO_PREFS,
    perTranslation: {},
    voiceByEngineLang: {},
    phoneBatteryNoticeSeen: {},
  };
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export const isSourceChoice = (x: unknown): x is AudioSourceChoice =>
  typeof x === 'string' && SOURCE_PATTERN.test(x);

/** Validate an unknown payload into prefs. Never throws. */
export function sanitizeAudioPrefs(raw: unknown): AudioPrefs {
  const out = defaultAudioPrefs();
  if (!isObject(raw)) return out;

  if (isSourceChoice(raw.source)) out.source = raw.source;

  if (isObject(raw.perTranslation)) {
    let kept = 0;
    for (const [module, value] of Object.entries(raw.perTranslation)) {
      if (kept >= MAX_PER_TRANSLATION) break;
      if (!isObject(value)) continue;
      const entry: { source?: AudioSourceChoice; voiceId?: string } = {};
      if (isSourceChoice(value.source)) entry.source = value.source;
      if (typeof value.voiceId === 'string' && value.voiceId) entry.voiceId = value.voiceId;
      if (Object.keys(entry).length > 0) { out.perTranslation[module] = entry; kept++; }
    }
  }

  if (isObject(raw.voiceByEngineLang)) {
    for (const [key, id] of Object.entries(raw.voiceByEngineLang)) {
      if (typeof id === 'string' && id) out.voiceByEngineLang[key] = id;
    }
  }

  if (typeof raw.rate === 'number' && Number.isFinite(raw.rate)) {
    out.rate = Math.min(GLOBAL_RATE.max, Math.max(GLOBAL_RATE.min, raw.rate));
  }
  if (typeof raw.followAlong === 'boolean') out.followAlong = raw.followAlong;
  if (typeof raw.autoScroll === 'boolean') out.autoScroll = raw.autoScroll;
  if (raw.continueAfterChapter === 'next-chapter' || raw.continueAfterChapter === 'stop') {
    out.continueAfterChapter = raw.continueAfterChapter;
  }
  if (typeof raw.readChapterIntro === 'boolean') out.readChapterIntro = raw.readChapterIntro;

  if (isObject(raw.phoneBatteryNoticeSeen)) {
    for (const [engine, seen] of Object.entries(raw.phoneBatteryNoticeSeen)) {
      if (seen === true) out.phoneBatteryNoticeSeen[engine] = true;
    }
  }
  return out;
}

export function loadAudioPrefs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): AudioPrefs {
  try {
    const text = storage?.getItem(AUDIO_PREFS_KEY);
    if (!text) return defaultAudioPrefs();
    return sanitizeAudioPrefs(JSON.parse(text));
  } catch {
    return defaultAudioPrefs();
  }
}

export function saveAudioPrefs(prefs: AudioPrefs, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(AUDIO_PREFS_KEY, JSON.stringify({ v: VERSION, ...prefs }));
  } catch { /* storage unavailable or full: the prefs simply do not persist */ }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // some privacy modes throw on access
  }
}

/**
 * The speed actually used: the wish clamped to the provider's range and snapped
 * to its step. A provider with no range has no speed control, so 1.
 */
export function effectiveRate(wish: number, caps: Pick<AudioCapabilities, 'rate'>): number {
  const range = caps.rate;
  if (!range) return 1;
  const clamped = Math.min(range.max, Math.max(range.min, wish));
  const steps = Math.round((clamped - range.min) / range.step + 1e-9);
  const snapped = range.min + steps * range.step;
  return Math.round(Math.min(range.max, Math.max(range.min, snapped)) * 100) / 100;
}
