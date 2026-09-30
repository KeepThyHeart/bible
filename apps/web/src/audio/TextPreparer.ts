/**
 * `ITextPreparer` for the languages the app ships: verse text to speakable text.
 *
 * The stored verse `text` is already clean canonical UTF-8, but a spoken
 * rendering still has to lose whatever a listener should not hear: footnote and
 * cross-reference markers, Strong's tags, publisher braces and pilcrows, the
 * square brackets some modules put round supplied words (the words stay), and
 * the small-caps divine name, which TTS engines otherwise spell out.
 *
 * The same rules will run in the production pipeline (a separate project) so
 * recorded and on-device audio say the same words; keep this file free of
 * browser APIs so it can be lifted there unchanged.
 *
 * Only English gets language-specific rewrites (LORD, "1 John" to "First
 * John"); other languages get the language-neutral cleanup and a short chapter
 * announcement where the word for "chapter" is known.
 */

import type { ChapterRef, ITextPreparer, VerseText } from '@bible/core/browser';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...',
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Language-neutral cleanup shared by every language. */
function cleanCommon(raw: string): string {
  let s = raw;
  // Markup first, then entities (so an escaped "&lt;" is not mistaken for a tag).
  s = s.replace(/<\/?(p|br|div|li)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  // Publisher notes and cross-reference blocks: {...} and (?)-style footnote runs.
  s = s.replace(/\{[^}]*\}/g, '');
  // Footnote markers: a lone letter or digit in brackets, and the usual glyphs.
  s = s.replace(/\[\s*[a-z0-9]{1,2}\s*\]/gi, '');
  s = s.replace(/[¶†‡*]/g, ' ');
  // Superscript letters / digits used as note markers.
  s = s.replace(/[ªº²³¹⁰-₟]/g, '');
  // Square brackets around supplied words: keep the words.
  s = s.replace(/[[\]]/g, '');
  // Dashes and ellipses become pauses a synthesizer honours. A dash at either
  // end of the verse has nothing to pause between, so it just goes.
  s = s.trim().replace(/^[\u2014\u2013]+\s*/, '').replace(/\s*[\u2014\u2013]+$/, '');
  s = s.replace(/\s*[—–]\s*/g, ', ').replace(/\s--+\s*/g, ', ').replace(/…/g, '...');
  // Curly quotes to straight; engines treat both alike but some phonemizers choke.
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/\s+/g, ' ').trim();
  // Removing a marker can strand punctuation after a space ("pastor [a];").
  s = s.replace(/\s+([,.;:!?\uff0c\u3002\uff1b\uff1a\uff01\uff1f\u3001])/g, '$1');
  return s;
}

/** Small-caps divine name and its neighbours, in English. */
function englishRewrites(s: string): string {
  return s
    .replace(/\bLORD(['’]S)?\b/g, (_m, poss?: string) => (poss ? "Lord's" : 'Lord'))
    .replace(/\bGOD(['’]S)?\b/g, (_m, poss?: string) => (poss ? "God's" : 'God'))
    .replace(/\bJEHOVAH\b/g, 'Jehovah')
    .replace(/\bYAHWEH\b/g, 'Yahweh')
    .replace(/\bSELAH\b/g, 'Selah')
    // Other all-caps words of four letters or more (small caps in print): sentence-case them.
    .replace(/\b([A-Z])([A-Z]{3,})\b/g, (_m, a: string, rest: string) => a + rest.toLowerCase());
}

const ENGLISH_ORDINAL: Record<string, string> = { '1': 'First', '2': 'Second', '3': 'Third' };

const CHAPTER_WORD: Record<string, (n: number) => string> = {
  en: n => `chapter ${n}`,
  es: n => `capítulo ${n}`,
  fr: n => `chapitre ${n}`,
  de: n => `Kapitel ${n}`,
  pt: n => `capítulo ${n}`,
  it: n => `capitolo ${n}`,
};

/** Books with one chapter: announced by name only. */
const SINGLE_CHAPTER_BOOKS = new Set([31, 57, 63, 64, 65]);
const PSALMS = 19;

const primary = (lang: string | undefined): string => (lang ?? 'en').toLowerCase().split(/[-_]/)[0];

export class TextPreparer implements ITextPreparer {
  chapterIntro(ref: ChapterRef, bookName: string, language?: string): string {
    const lang = primary(language);
    if (lang === 'zh') {
      return SINGLE_CHAPTER_BOOKS.has(ref.book) ? `${bookName}。` : `${bookName}，第${ref.chapter}章。`;
    }
    if (lang === 'en' || lang === '') {
      const name = spokenEnglishBookName(bookName);
      if (ref.book === PSALMS) return `Psalm ${ref.chapter}.`;
      if (SINGLE_CHAPTER_BOOKS.has(ref.book)) return `${name}.`;
      return `${name}, chapter ${ref.chapter}.`;
    }
    if (SINGLE_CHAPTER_BOOKS.has(ref.book)) return `${bookName}.`;
    const word = CHAPTER_WORD[lang];
    return word ? `${bookName}, ${word(ref.chapter)}.` : `${bookName} ${ref.chapter}.`;
  }

  verse(raw: VerseText, language: string): string {
    // `text` is canonical; markup is only trusted as a fallback.
    const source = raw.text?.trim() ? raw.text : (raw.html ?? '');
    let s = cleanCommon(source);
    if (primary(language) === 'en') s = englishRewrites(s);
    return s;
  }
}

function spokenEnglishBookName(name: string): string {
  return name.replace(/^([123])\s+(?=\S)/, (_m, d: string) => `${ENGLISH_ORDINAL[d]} `);
}
