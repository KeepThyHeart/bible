import { describe, it, expect } from 'vitest';
import {
  AUDIO_INDEX_SCHEMA,
  CHAPTER_MANIFEST_SCHEMA,
  Registry,
  buildFixtureManifest,
  manifestTimings,
  narratorHasChapter,
  narratorsForBook,
  pickPlayableFile,
  validateAudioIndex,
  validateChapterManifest,
  type AudioNarrator,
  type TranslationAudioIndex,
} from '../audio';

const good = () => buildFixtureManifest({ module: 'KJV', book: 43, chapter: 3, verseCount: 4, intro: 2 });

describe('validateChapterManifest', () => {
  it('accepts a well-formed manifest', () => {
    const r = validateChapterManifest(good());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.value?.verses).toHaveLength(4);
  });

  it('accepts verse 0 (Psalm title) and a manifest without an intro', () => {
    const m = good();
    m.intro = undefined;
    delete (m as { intro?: unknown }).intro;
    m.verses = [[0, 0, 3], [1, 3, 8]];
    m.duration = 8;
    expect(validateChapterManifest(m).ok).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['an HTML error page body', '<!doctype html>'],
  ])('rejects %s', (_n, input) => {
    expect(validateChapterManifest(input).ok).toBe(false);
  });

  it('rejects a wrong schema id', () => {
    const m = { ...good(), schema: 'kth-audio-chapter/2' };
    const r = validateChapterManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain(CHAPTER_MANIFEST_SCHEMA);
  });

  it('rejects out-of-range book and chapter', () => {
    expect(validateChapterManifest({ ...good(), book: 67 }).ok).toBe(false);
    expect(validateChapterManifest({ ...good(), book: 0 }).ok).toBe(false);
    expect(validateChapterManifest({ ...good(), chapter: 0 }).ok).toBe(false);
    expect(validateChapterManifest({ ...good(), chapter: 1.5 }).ok).toBe(false);
  });

  it('rejects empty files and empty verses', () => {
    expect(validateChapterManifest({ ...good(), files: [] }).ok).toBe(false);
    expect(validateChapterManifest({ ...good(), verses: [] }).ok).toBe(false);
  });

  it('rejects file paths that escape the chapter directory or are absolute or URLs', () => {
    for (const path of ['../x.ogg', '/etc/passwd', 'https://evil.example/x.ogg', 'a/../../b.ogg', 'file:x']) {
      const m = good();
      m.files[0].path = path;
      expect(validateChapterManifest(m).ok, path).toBe(false);
    }
  });

  it('rejects non-ascending, duplicate and overlapping verses', () => {
    const dup = good();
    dup.verses = [[1, 2, 7], [1, 7, 12]];
    expect(validateChapterManifest(dup).ok).toBe(false);
    const desc = good();
    desc.verses = [[2, 2, 7], [1, 7, 12]];
    expect(validateChapterManifest(desc).ok).toBe(false);
    const overlap = good();
    overlap.verses = [[1, 2, 9], [2, 8, 14]];
    expect(validateChapterManifest(overlap).ok).toBe(false);
  });

  it('rejects zero-length and negative timings, and verses past the duration', () => {
    const zero = good();
    zero.verses = [[1, 2, 2]];
    expect(validateChapterManifest(zero).ok).toBe(false);
    const neg = good();
    neg.verses = [[1, -1, 2]];
    expect(validateChapterManifest(neg).ok).toBe(false);
    const past = good();
    past.duration = 10;
    expect(validateChapterManifest(past).ok).toBe(false);
  });

  it('allows the last verse to overrun the duration by rounding slack only', () => {
    const m = good();
    m.duration = m.verses[m.verses.length - 1][2] - 0.3;
    expect(validateChapterManifest(m).ok).toBe(true);
  });

  it('rejects an intro that overlaps the first verse, or is malformed', () => {
    const m = good();
    m.intro = [0, 4];
    expect(validateChapterManifest(m).ok).toBe(false);
    const bad = { ...good(), intro: [3, 1] };
    expect(validateChapterManifest(bad).ok).toBe(false);
  });

  it('collects several errors at once', () => {
    const r = validateChapterManifest({ schema: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(3);
  });
});

describe('validateAudioIndex', () => {
  const narrator = (over: Partial<AudioNarrator> = {}): AudioNarrator => ({
    id: 'kjv-en-1', label: 'Server voice', language: 'en', rev: '2026.10.1', books: [43], ...over,
  });
  const index = (narrators: AudioNarrator[]): TranslationAudioIndex => ({
    schema: AUDIO_INDEX_SCHEMA, module: 'KJV', narrators,
  });

  it('accepts an index with no narrators (nothing recorded yet)', () => {
    expect(validateAudioIndex(index([])).ok).toBe(true);
  });

  it('accepts partial books', () => {
    expect(validateAudioIndex(index([narrator({ books: [], chapters: { '19': [1, 2, 3] } })])).ok).toBe(true);
  });

  it('rejects duplicates, bad books and bad chapter maps', () => {
    expect(validateAudioIndex(index([narrator(), narrator()])).ok).toBe(false);
    expect(validateAudioIndex(index([narrator({ books: [70] })])).ok).toBe(false);
    expect(validateAudioIndex(index([narrator({ chapters: { x: [1] } })])).ok).toBe(false);
    expect(validateAudioIndex(index([narrator({ chapters: { '19': [0] } })])).ok).toBe(false);
    expect(validateAudioIndex({ schema: 'wrong', module: 'KJV', narrators: [] }).ok).toBe(false);
    expect(validateAudioIndex(null).ok).toBe(false);
  });
});

describe('index helpers', () => {
  const full: AudioNarrator = { id: 'a', label: 'A', language: 'en', rev: '1', books: [43] };
  const partial: AudioNarrator = { id: 'b', label: 'B', language: 'en', rev: '1', books: [], chapters: { '19': [23] } };
  const index: TranslationAudioIndex = { schema: AUDIO_INDEX_SCHEMA, module: 'KJV', narrators: [full, partial] };

  it('narratorHasChapter covers whole books and single chapters', () => {
    expect(narratorHasChapter(full, 43, 3)).toBe(true);
    expect(narratorHasChapter(full, 44, 1)).toBe(false);
    expect(narratorHasChapter(partial, 19, 23)).toBe(true);
    expect(narratorHasChapter(partial, 19, 24)).toBe(false);
  });

  it('narratorsForBook lists narrators with any coverage of the book', () => {
    expect(narratorsForBook(index, 43).map(n => n.id)).toEqual(['a']);
    expect(narratorsForBook(index, 19).map(n => n.id)).toEqual(['b']);
    expect(narratorsForBook(index, 1)).toEqual([]);
  });
});

describe('pickPlayableFile and manifestTimings', () => {
  it('picks the first file the browser can play, in manifest order', () => {
    const m = good();
    expect(pickPlayableFile(m, () => true)?.codec).toBe('opus');
    expect(pickPlayableFile(m, t => t.startsWith('audio/mpeg'))?.codec).toBe('mp3');
    expect(pickPlayableFile(m, () => false)).toBeNull();
  });

  it('converts verses to timings', () => {
    const t = manifestTimings(good());
    expect(t[0]).toEqual({ verse: 1, start: 2, end: 7 });
    expect(t).toHaveLength(4);
  });
});

describe('Registry', () => {
  it('registers, lists, gets and unregisters', () => {
    const r = new Registry<{ id: string; n: number }>();
    const off = r.register({ id: 'a', n: 1 });
    r.register({ id: 'b', n: 2 });
    expect(r.list().map(x => x.id)).toEqual(['a', 'b']);
    expect(r.get('a')?.n).toBe(1);
    off();
    expect(r.get('a')).toBeUndefined();
  });

  it('lets the last registration of an id win, and an old unregister not remove it', () => {
    const r = new Registry<{ id: string; n: number }>();
    const off1 = r.register({ id: 'a', n: 1 });
    r.register({ id: 'a', n: 2 });
    expect(r.get('a')?.n).toBe(2);
    off1();
    expect(r.get('a')?.n).toBe(2);
  });
});
