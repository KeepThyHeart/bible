/**
 * Validation and helpers for the recorded channel's two published documents:
 * the per-chapter manifest (`kth-audio-chapter/1`) and the per-translation
 * index (`kth-audio-index/1`).
 *
 * The web app validates whatever it downloads, so a bad build (or a proxy that
 * answers with an HTML error page) is reported as "no recording" rather than
 * corrupting playback. The production pipeline (a separate project) can reuse
 * the same functions, or the JSON Schemas in `manifestSchema.ts`, to validate
 * what it publishes.
 */

import {
  AUDIO_INDEX_SCHEMA,
  CHAPTER_MANIFEST_SCHEMA,
  type AudioNarrator,
  type ChapterManifest,
  type ManifestFile,
  type TranslationAudioIndex,
  type VerseTiming,
} from './types';

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

/** Tolerance, in seconds, for a verse ending slightly past the declared duration. */
const DURATION_SLACK = 0.5;

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

/** A relative path with no way out of its directory. */
function isSafeRelativePath(p: string): boolean {
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return false;
  return !p.split(/[\\/]/).some(seg => seg === '..');
}

export function validateChapterManifest(input: unknown): ValidationResult<ChapterManifest> {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ['manifest is not an object'] };
  const m = input;

  if (m.schema !== CHAPTER_MANIFEST_SCHEMA) errors.push(`schema must be "${CHAPTER_MANIFEST_SCHEMA}"`);
  if (!isStr(m.module)) errors.push('module must be a non-empty string');
  if (!isInt(m.book) || m.book < 1 || m.book > 66) errors.push('book must be an integer 1-66');
  if (!isInt(m.chapter) || m.chapter < 1) errors.push('chapter must be an integer >= 1');
  if (!isStr(m.narrator)) errors.push('narrator must be a non-empty string');
  if (!isStr(m.rev)) errors.push('rev must be a non-empty string');
  if (m.textHash !== undefined && !isStr(m.textHash)) errors.push('textHash must be a string when present');
  if (!isNum(m.duration) || m.duration <= 0) errors.push('duration must be a positive number');

  if (!Array.isArray(m.files) || m.files.length === 0) {
    errors.push('files must be a non-empty array');
  } else {
    m.files.forEach((f, i) => {
      if (!isObject(f)) { errors.push(`files[${i}] is not an object`); return; }
      if (!isStr(f.codec)) errors.push(`files[${i}].codec must be a non-empty string`);
      if (!isStr(f.mime)) errors.push(`files[${i}].mime must be a non-empty string`);
      if (!isStr(f.path)) errors.push(`files[${i}].path must be a non-empty string`);
      else if (!isSafeRelativePath(f.path)) errors.push(`files[${i}].path must be a relative path without ".."`);
      if (!isNum(f.bytes) || f.bytes < 0) errors.push(`files[${i}].bytes must be a non-negative number`);
      if (f.sha256 !== undefined && !isStr(f.sha256)) errors.push(`files[${i}].sha256 must be a string when present`);
    });
  }

  const duration = isNum(m.duration) ? m.duration : Infinity;
  let introEnd = 0;
  if (m.intro !== undefined) {
    const i = m.intro;
    if (!Array.isArray(i) || i.length !== 2 || !isNum(i[0]) || !isNum(i[1]) || i[0] < 0 || i[1] <= i[0]) {
      errors.push('intro must be [start, end] with 0 <= start < end');
    } else {
      introEnd = i[1];
    }
  }

  if (!Array.isArray(m.verses) || m.verses.length === 0) {
    errors.push('verses must be a non-empty array');
  } else {
    let prevVerse = -1;
    let prevEnd = introEnd;
    m.verses.forEach((v, i) => {
      if (!Array.isArray(v) || v.length !== 3 || !isInt(v[0]) || !isNum(v[1]) || !isNum(v[2])) {
        errors.push(`verses[${i}] must be [verse, start, end]`);
        return;
      }
      const [verse, start, end] = v as [number, number, number];
      if (verse < 0) errors.push(`verses[${i}]: verse must be >= 0`);
      if (verse <= prevVerse) errors.push(`verses[${i}]: verse numbers must be strictly ascending`);
      if (start < 0 || end <= start) errors.push(`verses[${i}]: need 0 <= start < end`);
      if (start + 1e-6 < prevEnd) errors.push(`verses[${i}]: overlaps the previous verse`);
      if (end > duration + DURATION_SLACK) errors.push(`verses[${i}]: ends after the chapter duration`);
      prevVerse = verse;
      prevEnd = end;
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: m as unknown as ChapterManifest, errors };
}

export function validateAudioIndex(input: unknown): ValidationResult<TranslationAudioIndex> {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ['index is not an object'] };
  const x = input;

  if (x.schema !== AUDIO_INDEX_SCHEMA) errors.push(`schema must be "${AUDIO_INDEX_SCHEMA}"`);
  if (!isStr(x.module)) errors.push('module must be a non-empty string');
  if (!Array.isArray(x.narrators)) {
    errors.push('narrators must be an array');
  } else {
    const seen = new Set<string>();
    x.narrators.forEach((n, i) => {
      if (!isObject(n)) { errors.push(`narrators[${i}] is not an object`); return; }
      if (!isStr(n.id)) errors.push(`narrators[${i}].id must be a non-empty string`);
      else if (seen.has(n.id)) errors.push(`narrators[${i}].id is a duplicate`);
      else seen.add(n.id);
      if (!isStr(n.label)) errors.push(`narrators[${i}].label must be a non-empty string`);
      if (!isStr(n.language)) errors.push(`narrators[${i}].language must be a non-empty string`);
      if (!isStr(n.rev)) errors.push(`narrators[${i}].rev must be a non-empty string`);
      if (!Array.isArray(n.books) || !n.books.every(b => isInt(b) && b >= 1 && b <= 66)) {
        errors.push(`narrators[${i}].books must be an array of book numbers 1-66`);
      }
      if (n.chapters !== undefined) {
        if (!isObject(n.chapters)) errors.push(`narrators[${i}].chapters must be an object`);
        else {
          for (const [k, list] of Object.entries(n.chapters)) {
            const book = Number(k);
            if (!Number.isInteger(book) || book < 1 || book > 66 || !Array.isArray(list) || !list.every(c => isInt(c) && c >= 1)) {
              errors.push(`narrators[${i}].chapters["${k}"] must be an array of chapter numbers`);
            }
          }
        }
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: x as unknown as TranslationAudioIndex, errors };
}

/** Whether the narrator has this chapter recorded. */
export function narratorHasChapter(narrator: AudioNarrator, book: number, chapter: number): boolean {
  if (narrator.books.includes(book)) return true;
  return narrator.chapters?.[String(book)]?.includes(chapter) ?? false;
}

/** Narrators of an index that cover `book` (any chapter of it), in index order. */
export function narratorsForBook(index: TranslationAudioIndex, book: number): AudioNarrator[] {
  return index.narrators.filter(n =>
    n.books.includes(book) || (n.chapters?.[String(book)]?.length ?? 0) > 0);
}

/**
 * The first file, in manifest order, whose MIME type the browser says it can
 * play. `canPlay` is normally `type => audio.canPlayType(type) !== ''`. Null
 * when none can, which the caller reports as "cannot play here".
 */
export function pickPlayableFile(
  manifest: ChapterManifest,
  canPlay: (mime: string) => boolean,
): ManifestFile | null {
  return manifest.files.find(f => canPlay(f.mime)) ?? null;
}

/** The manifest's verse timings as `VerseTiming` objects (chapter-relative). */
export function manifestTimings(manifest: ChapterManifest): VerseTiming[] {
  return manifest.verses.map(([verse, start, end]) => ({ verse, start, end }));
}

/**
 * Build a `ChapterManifest` for tests and tooling. Verses are laid end to end,
 * `secondsPerVerse` each, after an optional intro.
 */
export function buildFixtureManifest(opts: {
  module: string;
  book: number;
  chapter: number;
  verseCount: number;
  narrator?: string;
  rev?: string;
  secondsPerVerse?: number;
  intro?: number;
  files?: ManifestFile[];
}): ChapterManifest {
  const per = opts.secondsPerVerse ?? 5;
  const introLen = opts.intro ?? 0;
  const verses: ChapterManifest['verses'] = [];
  let t = introLen;
  for (let v = 1; v <= opts.verseCount; v++) {
    verses.push([v, t, t + per]);
    t += per;
  }
  const ccc = String(opts.chapter).padStart(3, '0');
  return {
    schema: CHAPTER_MANIFEST_SCHEMA,
    module: opts.module,
    book: opts.book,
    chapter: opts.chapter,
    narrator: opts.narrator ?? 'fixture-1',
    rev: opts.rev ?? '0',
    duration: t,
    files: opts.files ?? [
      { codec: 'opus', mime: 'audio/ogg; codecs=opus', path: `${opts.book}/${ccc}.ogg`, bytes: 1000 },
      { codec: 'mp3', mime: 'audio/mpeg', path: `${opts.book}/${ccc}.mp3`, bytes: 2000 },
    ],
    ...(introLen > 0 ? { intro: [0, introLen] as [number, number] } : {}),
    verses,
  };
}
