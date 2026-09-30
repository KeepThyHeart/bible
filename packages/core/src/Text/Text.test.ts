import { describe, it, expect } from 'vitest';
import {
  porterStem, getStemmer, registerStemmer, foldWord, foldLemma, tokenizeVerseWords, tokenizePhrase,
  normalizeToken, normalizeArchaic, compileTermMatcher, countForms, parseTermQuery, findPhraseMatches,
  isStopWord, getStopWords, canonicalLanguage,
} from './index';
import { extractWords } from '../Services/WordIndexing';

describe('stemmers', () => {
  it('folds English inflections, including archaic -eth', () => {
    const stems = ['love', 'loved', 'loveth', 'loving', 'loves'].map(porterStem);
    expect(new Set(stems).size).toBe(1);
    expect(porterStem('walking')).toBe(porterStem('walked'));
    expect(porterStem('faith')).toBe('faith');
  });
  it('has light stemmers for other languages and none for unknown ones', () => {
    expect(getStemmer('es')!('amados')).toBe(getStemmer('es')!('amadas'));
    expect(getStemmer('en-US')).toBeDefined();
    expect(getStemmer('eng')).toBeDefined();
    expect(getStemmer('el')).toBeUndefined();
  });
  it('accepts a registered stemmer', () => {
    registerStemmer('xx', (w) => w.replace(/z$/, ''));
    expect(getStemmer('xx')!('abz')).toBe('ab');
  });
});

describe('folding, normalising and tokenising', () => {
  it('folds Greek accents, final sigma and Hebrew points', () => {
    expect(foldWord('ἀγάπη')).toBe('αγαπη');
    expect(foldWord('λόγος')).toBe('λογοσ');
    expect(foldWord('λογος')).toBe(foldWord('Λόγος'));
    expect(foldWord('בְּרֵאשִׁית')).toBe('בראשית');
    expect(foldLemma("ag-ap-ah'-o")).toBe('agapaho');
  });
  it('normalizeToken keeps accents, folds curly apostrophes and case', () => {
    expect(normalizeToken('“Can’t,”')).toBe("can't");
    expect(normalizeToken('Él')).toBe('él');
    expect(normalizeToken('LORD', true)).toBe('LORD');
    expect(tokenizePhrase('So  that,')).toEqual(['so', 'that']);
  });
  it('indexes words by whitespace and trims edge punctuation', () => {
    const w = tokenizeVerseWords('For God so loved the world, that');
    expect(w[3]).toEqual({ index: 3, text: 'loved' });
    expect(w[5].text).toBe('world');
  });
  it('agrees with the WordIndexing index space, including punctuation-only tokens', () => {
    const text = 'And he said — Lo, it is "I."';
    expect(tokenizeVerseWords(text).length).toBe(extractWords(text).length);
  });
  it('modernises archaic English only for English', () => {
    expect(normalizeArchaic('thou')).toBe('you');
    expect(normalizeArchaic('loveth')).toBe('loves');
    expect(normalizeArchaic('goeth')).toBe('goes');
    expect(normalizeArchaic('thou', 'es')).toBe('thou');
  });
});

describe('stop words', () => {
  it('folds before testing and knows languages', () => {
    expect(isStopWord('The', 'en-GB')).toBe(true);
    expect(isStopWord('love', 'en')).toBe(false);
    expect(isStopWord('Aquí', 'es')).toBe(true);
    expect(getStopWords('xx').size).toBe(0);
    expect(canonicalLanguage('spa')).toBe('es');
  });
});

describe('term matcher', () => {
  const text = 'For God so loved the world; he that loveth not knoweth not God, for God is love. A lovely, loving-kindness.';
  const run = (o: Parameters<typeof compileTermMatcher>[0]) => compileTermMatcher(o).matchText(text);
  it('matches inflections with stemming, and reports positions and forms', () => {
    const m = run({ terms: ['love'], language: 'en' });
    expect(m.map((x) => x.form)).toEqual(['loved', 'loveth', 'love', 'lovely', 'loving-kindness']);
    expect(m[0]).toMatchObject({ start: 3, end: 3 });
  });
  it('does not stem when stem is false', () => {
    expect(run({ terms: ['love'], stem: false, language: 'en' }).map((x) => x.form)).toEqual(['love']);
  });
  it('supports variants, prefix wildcards, exact forms, phrases and exclusions', () => {
    const m = run({ terms: ['beloved', 'lov*', '=world', 'God is'], exclude: ['lovely'], stem: false, language: 'en' });
    expect(m.map((x) => x.form)).toEqual(['loved', 'world', 'loveth', 'God is', 'love', 'loving-kindness']);
  });
  it('excludes by stem-conflated forms with exclude', () => {
    const m = run({ terms: ['love'], exclude: ['lovely'], language: 'en' });
    expect(m.map((x) => x.form)).toEqual(['loved', 'loveth', 'love', 'loving-kindness']);
  });
  it('works without a stemmer for a language, using variants', () => {
    const matcher = compileTermMatcher({ terms: ['ἀγάπη', 'ἀγαπάω', 'ἀγαπᾷ'], language: 'el' });
    expect(matcher.stemming).toBe(false);
    expect(matcher.matchText('ὁ θεὸς ἀγάπη ἐστίν, ἀγαπᾷ').length).toBe(2);
  });
  it('folds archaic forms on both sides when asked', () => {
    const m = compileTermMatcher({ terms: ['you'], stem: false, archaic: true, language: 'en' });
    expect(m.matchText('thou art he, and ye know').map((x) => x.form)).toEqual(['thou', 'ye']);
    expect(compileTermMatcher({ terms: ['you'], stem: false }).matchText('thou ye')).toEqual([]);
  });
  it('matchesWord and matchWords work on single words and pre-split tokens', () => {
    const m = compileTermMatcher({ terms: ['love'], language: 'en' });
    expect(m.matchesWord('Loveth,')).toBe(true);
    expect(m.matchesWord('hate')).toBe(false);
    expect(m.matchWords(['a', 'love']).map((x) => x.start)).toEqual([1]);
  });
  it('parses typed queries and counts forms', () => {
    expect(parseTermQuery('love, lov*, -lovely')).toEqual({ terms: ['love', 'lov*'], exclude: ['lovely'] });
    const m = compileTermMatcher({ terms: ['love', 'loved', 'beloved', 'lov*'], language: 'en' }).matchText('love Love loved');
    expect(countForms(m)).toEqual([{ form: 'love', count: 2 }, { form: 'loved', count: 1 }]);
  });
});

describe('findPhraseMatches', () => {
  it('matches phrases, case-insensitive by default, deduped and sorted', () => {
    const toks = ['So', 'that', 'he', 'said,', 'so', 'that', 'so'];
    expect(findPhraseMatches(toks, ['so that', 'so'])).toEqual([[0, 1], [0, 0], [4, 5], [4, 4], [6, 6]].sort((a, b) => a[0] - b[0]));
    expect(findPhraseMatches(toks, ['so'], true)).toEqual([[4, 4], [6, 6]]);
  });
});
