import { describe, it, expect } from 'vitest';
import {
  porterStem, getStemmer, compileWordGroup, normalizeWordGroup, groupFromQuery, countForms,
  parseStrongsDefinition, normalizeRendering, groupRenderings, glossMatchesRendering, foldWord, foldLemma,
  tokenizeVerseWords, registerStemmer,
} from './index';

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
    registerStemmer('xx', w => w.replace(/z$/, ''));
    expect(getStemmer('xx')!('abz')).toBe('ab');
  });
});

describe('folding and tokenising', () => {
  it('folds Greek accents, final sigma and Hebrew points', () => {
    expect(foldWord('ἀγάπη')).toBe('αγαπη');
    expect(foldWord('λόγος')).toBe('λογοσ');
    expect(foldWord('λογος')).toBe(foldWord('Λόγος'));
    expect(foldWord('בְּרֵאשִׁית')).toBe('בראשית');
    expect(foldLemma("ag-ap-ah'-o")).toBe('agapaho');
  });
  it('indexes words by whitespace and trims edge punctuation', () => {
    const w = tokenizeVerseWords('For God so loved the world, that');
    expect(w[3]).toEqual({ index: 3, text: 'loved' });
    expect(w[5].text).toBe('world');
  });
});

describe('word groups', () => {
  const text = 'For God so loved the world; he that loveth not knoweth not God, for God is love. A lovely, loving-kindness.';
  it('matches inflections with stemming, and reports positions and forms', () => {
    const m = compileWordGroup({ id: 'g', label: 'love', terms: ['love'] }, 'en').matchText(text);
    expect(m.map(x => x.form)).toEqual(['loved', 'loveth', 'love', 'lovely', 'loving-kindness']); // Porter also conflates lovely: use `exclude`
    expect(m[0]).toMatchObject({ start: 3, end: 3 });
  });
  it('does not stem when stem is false', () => {
    const m = compileWordGroup({ id: 'g', label: 'love', terms: ['love'], stem: false }, 'en').matchText(text);
    expect(m.map(x => x.form)).toEqual(['love']);
  });
  it('supports variants, prefix wildcards, exact forms, phrases and exclusions', () => {
    const g = normalizeWordGroup({ label: 'g', terms: ['beloved', 'lov*', '=world', 'God is'], exclude: ['lovely'], stem: false });
    const m = compileWordGroup(g, 'en').matchText(text);
    expect(m.map(x => x.form)).toEqual(['loved', 'world', 'loveth', 'God is', 'love', 'loving-kindness']);
  });
  it('works without a stemmer for a language, using variants', () => {
    const g = normalizeWordGroup({ label: 'agape', terms: ['ἀγάπη', 'ἀγαπάω', 'ἀγαπᾷ'] });
    const matcher = compileWordGroup(g, 'el');
    expect(matcher.stemming).toBe(false);
    expect(matcher.matchText('ὁ θεὸς ἀγάπη ἐστίν, ἀγαπᾷ').length).toBe(2);
  });
  it('builds groups from typed queries and counts forms', () => {
    const g = groupFromQuery('love, loved; beloved | lov*');
    expect(g.label).toBe('love');
    expect(g.terms).toEqual(['love', 'loved', 'beloved', 'lov*']);
    const m = compileWordGroup(g, 'en').matchText('love Love loved');
    expect(countForms(m)).toEqual([{ form: 'love', count: 2 }, { form: 'loved', count: 1 }]);
  });
});

describe('parseStrongsDefinition', () => {
  const g25 = "25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o} \n perhaps from agan (much); to love (in a social or moral sense):--(be-)love(-ed). Compare 5368.  see GREEK for 5368 \n ";
  it('parses header, sense, renderings and references', () => {
    const p = parseStrongsDefinition(g25, 'Greek');
    expect(p).toMatchObject({ number: 25, originalWord: 'ἀγαπάω', transliteration: 'agapao', pronunciation: "ag-ap-ah'-o" });
    expect(p.sense).toContain('to love');
    expect(p.lexiconRenderings).toEqual(['(be-)love(-ed)']);
    expect(p.compareRefs).toEqual([5368]);
  });
  it('finds derivation', () => {
    const p = parseStrongsDefinition("26 ἀγάπη ajgavph agape {ag-ah'-pay} \n from 25; love:--(feast of) charity(-ably), dear, love.  see GREEK for 25 \n ", 'Greek');
    expect(p.derivedFrom).toBe(25);
    expect(p.seeRefs).toEqual([]);
    expect(p.lexiconRenderings).toEqual(['(feast of) charity(-ably)', 'dear', 'love']);
  });
  it('degrades on an unparseable entry', () => {
    expect(parseStrongsDefinition('999 some word', 'Hebrew').number).toBe(999);
  });
});

describe('renderings', () => {
  it('normalises phrases and picks the head word', () => {
    expect(normalizeRendering('Thou shalt love,')).toEqual({ phrase: 'thou shalt love', head: 'love' });
  });
  it('groups by head with stemming, or by phrase', () => {
    const rows = [
      { gloss: 'love', count: 26 }, { gloss: 'loved', count: 15 }, { gloss: 'loveth', count: 12 },
      { gloss: 'thou shalt love', count: 10 }, { gloss: 'beloved', count: 7 },
    ];
    const head = groupRenderings(rows, 'head');
    expect(head[0]).toMatchObject({ label: 'love', count: 63 });
    expect(head[0].members.length).toBe(4);
    expect(head[1].label).toBe('beloved');
    expect(head[0].share + head[1].share).toBeCloseTo(1);
    expect(groupRenderings(rows, 'phrase').length).toBe(5);
    expect(glossMatchesRendering('thou shalt love', head[0].key)).toBe(true);
    expect(glossMatchesRendering('beloved', head[0].key)).toBe(false);
  });
});
