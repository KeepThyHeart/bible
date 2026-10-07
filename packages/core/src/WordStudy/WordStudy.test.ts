import { describe, it, expect } from 'vitest';
import {
  compileWordGroup, normalizeWordGroup, groupFromQuery,
  parseStrongsDefinition, normalizeRendering, groupRenderings, glossMatchesRendering,
} from './index';
import { countForms, foldWord, tokenizeVerseWords, registerStemmer } from '../Text';

describe('shared Text registry', () => {
  it('uses a stemmer registered with the public registerStemmer in compileWordGroup', () => {
    expect(compileWordGroup({ id: 'g', label: 'x', terms: ['abz'] }, 'qq').stemming).toBe(false);
    registerStemmer('qq', w => w.replace(/z+$/, ''));
    const m = compileWordGroup({ id: 'g', label: 'x', terms: ['abz'] }, 'qq');
    expect(m.stemming).toBe(true);
    expect(m.matchText('ab abzz cd').map(x => x.form)).toEqual(['ab', 'abzz']);
    expect(groupRenderings([{ gloss: 'abz', count: 1 }, { gloss: 'ab', count: 2 }], 'head', 'qq')).toHaveLength(1);
  });
  it('word group results are unchanged by the shared tokenizer, folding and countForms', () => {
    expect(foldWord('λόγος')).toBe('λογοσ');
    expect(tokenizeVerseWords('For God so loved')[3]).toEqual({ index: 3, text: 'loved' });
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
  it('parses the Hebrew layout (no script, optional variant and braces)', () => {
    const a = parseStrongsDefinition("157 'ahab aw-hab' or raheb {aw-habe'}; a primitive root; to have affection for (sexually or otherwise):--(be-)love(-d, -ly, -r), like, friend.", 'Hebrew');
    expect(a.transliteration).toBe("'ahab");
    expect(a.pronunciation).toBe("aw-hab'");
    expect(a.originalWord).toBeUndefined();
    expect(a.sense).toBe('a primitive root; to have affection for (sexually or otherwise)');
    const b = parseStrongsDefinition("430 'elohiym el-o-heem' plural of 433; gods in the ordinary sense:--angels, God. see HEBREW for 0433", 'Hebrew');
    expect(b.transliteration).toBe("'elohiym");
    expect(b.derivedFrom).toBe(433);
    expect(b.sense).toBe('plural of 433; gods in the ordinary sense');
  });
  it('degrades on an unparseable entry', () => {
    expect(parseStrongsDefinition('999 some word', 'Hebrew').number).toBe(999);
  });
});

describe('groupFromQuery exclusions', () => {
  it('moves -terms into exclude', () => {
    const g = groupFromQuery('love, lov*, -lovely');
    expect(g.terms).toEqual(['love', 'lov*']);
    expect(g.exclude).toEqual(['lovely']);
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
