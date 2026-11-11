/**
 * The pronunciation overlay against real things: the fixture KJV module, the real espeak-ng
 * build (piper-wasm) and the real kokoro-js package. No model runs.
 *
 * The data itself lives in bible-scripts (`pronunciation/`). Its checks here run when a copy
 * is available: `KTH_PRONUNCIATION_DIR`, else a bible-scripts checkout next to this repo.
 * Everything else uses the small overlay written below.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TextPreparer, applyPronunciation, parsePronunciationLexicon, parsePronunciationSenses, pronunciationVerseKey,
  spokenTextHash, type PronunciationOverlay,
} from './core';
import { kokoroMarkedPhonemes, kokoroPhonemes, type KokoroInstance } from './engines/kokoro';
import { loadPhonemizerAssets, phonemizeWith } from './engines/piper';
import { openModuleText } from './moduleSource';
import { loadPronunciation, voiceLanguage } from './pronunciation';
import { piperDefinition } from './engines/piper';
import { kokoroDefinition } from './engines/kokoro';
import { prepareChapterText } from './text';

const REPO = resolve(__dirname, '../../..');
const DATA = resolve(process.env.KTH_PRONUNCIATION_DIR ?? join(REPO, '../bible-scripts/pronunciation'));
const HAVE_DATA = existsSync(join(DATA, 'en-us', 'lexicon.json'));

/** A small overlay in the bible-scripts layout. */
const GEN_1_22 = 'And God blessed them, saying, Be fruitful, and multiply, and fill the waters in the seas, and let fowl multiply in the earth.';
const FIXTURE: Record<string, unknown> = {
  'en-us/lexicon.json': {
    format: 'kth-pron-lexicon/2', locale: 'en-us',
    entries: { hast: 'hˈæst', Melchizedek: 'mɛlkˈɪzᵻdɛk' },
    senses: { blessed: { adjective: 'blˈɛsᵻd', verb: 'blˈɛst' } },
  },
  'en/KJV.json': {
    format: 'kth-pron-senses/1', module: 'KJV', language: 'en',
    verses: { 'GEN.1.22': { hash: spokenTextHash(GEN_1_22), words: { 2: ['blessed', 'verb'] } } },
  },
  'en-us/KJV.json': {
    format: 'kth-pron-module/1', module: 'KJV', locale: 'en-us',
    verses: { 'GEN.1.22': { hash: spokenTextHash(GEN_1_22), words: { 1: ['God', 'ɡˈɑːd'] } } },
  },
};

function fixtureDir(files: Record<string, unknown> = FIXTURE): string {
  const dir = mkdtempSync(join(tmpdir(), 'pron-'));
  for (const [rel, json] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(json));
  }
  return dir;
}

describe('loading an overlay for a run', () => {
  it('reads the three layers, and voices map to their locale', () => {
    const loaded = loadPronunciation(fixtureDir(), 'en-us', 'kjv');
    expect(loaded.summary).toBe('Pronunciation (en-us): 2 words, 1 KJV verses with homographs, 1 KJV verses with overrides.');
    expect(applyPronunciation(GEN_1_22, loaded.overlay, 'GEN.1.22')).toMatch(/^And ⟦God\|ɡˈɑːd⟧ ⟦blessed\|blˈɛst⟧ them/);
    expect(voiceLanguage(piperDefinition, 'en_US-amy-low')).toBe('en-US');
    expect(voiceLanguage(piperDefinition, 'en_GB-alan-low')).toBe('en-GB');
    expect(voiceLanguage(kokoroDefinition, 'bm_george')).toBe('en-GB');
  });

  it('a locale with no lexicon gets nothing; a file for the wrong locale or module is an error', () => {
    expect(loadPronunciation(fixtureDir(), 'en-gb', 'KJV').overlay).toBeNull();
    expect(() => loadPronunciation(fixtureDir({ 'en-us/lexicon.json': { ...(FIXTURE['en-us/lexicon.json'] as object), locale: 'en-gb' } }), 'en-us', 'KJV')).toThrow(/not an en-us/);
    expect(() => loadPronunciation(fixtureDir({ 'en/WEB.json': FIXTURE['en/KJV.json'] }), 'en-us', 'WEB')).toThrow(/senses file for WEB/);
  });
});

describe.skipIf(!HAVE_DATA)('bible-scripts pronunciation data', () => {
  const raw = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8')) as {
    entries?: Record<string, string>; senses?: Record<string, Record<string, string>>;
    verses?: Record<string, { words: Record<string, unknown> }>;
  };
  /** Every symbol espeak-ng en-us prints (the set the review used). */
  const INVENTORY = new Set([...'abdefhijklmnoprstuvwxzæðŋɐɑɔəɚɛɜɡɪɹɾʃʊʌʒʔˈˌː̩θᵻ']);
  const WORD = /\p{L}+(?:'\p{L}+)*/gu;

  it('parses with nothing dropped, only espeak symbols, and every sense defined', () => {
    const lexicon = parsePronunciationLexicon(raw('en-us/lexicon.json'))!;
    const senses = parsePronunciationSenses(raw('en/KJV.json'))!;
    expect(lexicon.entries.size).toBe(Object.keys(raw('en-us/lexicon.json').entries!).length);
    expect(lexicon.senses.size).toBe(Object.keys(raw('en-us/lexicon.json').senses!).length);
    const rawWords = Object.values(raw('en/KJV.json').verses!).reduce((n, v) => n + Object.keys(v.words).length, 0);
    expect([...senses.verses.values()].reduce((n, v) => n + v.words.size, 0)).toBe(rawWords);
    const ipa = [...lexicon.entries.values(), ...[...lexicon.senses.values()].flatMap(m => [...m.values()])];
    expect(ipa.filter(i => [...i].some(c => !INVENTORY.has(c)))).toEqual([]);
    const undefinedSenses = [...senses.verses.values()].flatMap(v => [...v.words.values()]).filter(([w, l]) => !lexicon.senses.get(w.toLowerCase())?.has(l));
    expect(undefinedSenses).toEqual([]);
  });

  it('every KJV occurrence in the fixture module lands on its word', () => {
    const senses = parsePronunciationSenses(raw('en/KJV.json'))!;
    const mod = openModuleText(join(REPO, 'fixtures/bible-data/modules/bible_kjv.db'));
    const prep = new TextPreparer();
    let checked = 0;
    try {
      for (const [book, chapters] of mod.chapters()) {
        for (const chapter of chapters) {
          for (const v of mod.verses(book, chapter)) {
            const key = pronunciationVerseKey(book, chapter, v.verse)!;
            const entry = senses.verses.get(key);
            if (!entry) continue;
            const text = prep.verse(v, mod.language).trim();
            expect(spokenTextHash(text), key).toBe(entry.hash);
            const words = [...text.matchAll(WORD)].map(m => m[0]);
            for (const [i, [word]] of entry.words) expect(words[i], `${key} #${i}`).toBe(word);
            checked++;
          }
        }
      }
    } finally {
      mod.close();
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('loads for a run', () => {
    expect(loadPronunciation(DATA, 'en-us', 'KJV').summary).toMatch(/^Pronunciation \(en-us\): \d+ words, \d+ KJV verses with homographs\.$/);
  });
});

describe('Piper splicing with the real phonemizer', () => {
  const sentences = (s: string[][]): string => s.map(x => x.join('')).join('|');

  it('a correction equal to espeak\'s own word leaves the sentence unchanged', async () => {
    const assets = await loadPhonemizerAssets();
    const cases: Array<[string, string]> = [
      ['And God blessed them, saying, Be fruitful, and multiply.', 'blessed'],
      ['Of the altar beneath, that the net may be even to the midst of the altar.', 'altar'],
      ['And Jacob sent messengers before him to Esau his brother.', 'Esau'],
    ];
    for (const [text, word] of cases) {
      const ownIpa = (await phonemizeWith(assets, word, 'en-us'))[0].join('');
      const spliced = text.replace(word, `⟦${word}|${ownIpa}⟧`);
      expect(sentences(await phonemizeWith(assets, spliced, 'en-us')), text).toBe(sentences(await phonemizeWith(assets, text, 'en-us')));
    }
  }, 60_000);

  it('speaks the KJV corrections', async () => {
    const assets = await loadPhonemizerAssets();
    const overlay: PronunciationOverlay = loadPronunciation(fixtureDir(), 'en-us', 'KJV').overlay!;
    const text = 'And Melchizedek king of Salem brought forth bread and wine: and he was the priest of the most high God.';
    const out = sentences(await phonemizeWith(assets, applyPronunciation(text, overlay, 'GEN.14.18'), 'en-us'));
    expect(out).toContain('mɛlkˈɪzᵻdɛk');
    expect(out).not.toContain('mango');
    const why = sentences(await phonemizeWith(assets, applyPronunciation('Why hast thou done this?', overlay), 'en-us'));
    expect(why).toContain('hˈæst');
  }, 60_000);
});

describe('Kokoro with markers', () => {
  it('splices IPA between Kokoro\'s own phonemes for the plain runs, with the text\'s spaces', async () => {
    const seen: string[] = [];
    const fake = async (t: string) => { seen.push(t); return t.trim().toUpperCase(); };
    expect(await kokoroMarkedPhonemes(fake, 'And God ⟦blessed|blˈɛst⟧ them, saying.')).toBe('AND GOD blˈɛst THEM, SAYING.');
    expect(await kokoroMarkedPhonemes(fake, '⟦Job|dʒˈoʊb⟧, answered.')).toBe('dʒˈoʊb, ANSWERED.');
    expect(seen).toContain(' them, saying.');
  });

  it('the phoneme probe reads what the real kokoro-js generate() would tokenize', async () => {
    const kokoro = (await import('kokoro-js')) as unknown as { KokoroTTS: { prototype: object } };
    // An instance with the real prototype (its private phonemizer and voice check), no model.
    const tts = Object.create(kokoro.KokoroTTS.prototype) as KokoroInstance;
    const out = await kokoroPhonemes(tts, 'Hello world.', 'am_michael');
    expect(out).toBe('həlˈoʊ wˈɜːld.');
  }, 60_000);
});

describe('recording text', () => {
  it('a correction changes the chapter text hash (so the chapter renders again)', () => {
    const verses = [{ verse: 1, text: 'Why hast thou done this?' }];
    const input = { moduleAbbr: 'KJV', book: 1, chapter: 3, bookName: 'Genesis', language: 'en', verses };
    const prep = new TextPreparer();
    const plain = prepareChapterText(prep, input);
    const overlay = loadPronunciation(fixtureDir(), 'en-us', 'KJV').overlay;
    const marked = prepareChapterText(prep, { ...input, pronounce: (t, v) => applyPronunciation(t, overlay, v === null ? undefined : pronunciationVerseKey(1, 3, v)) });
    expect(marked.verses[0].text).toBe('Why ⟦hast|hˈæst⟧ thou done this?');
    expect(marked.textHash).not.toBe(plain.textHash);
  });
});
