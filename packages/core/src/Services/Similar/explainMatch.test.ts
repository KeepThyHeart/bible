import { describe, it, expect } from 'vitest';
import { explainMatch } from './explainMatch';
import type { PassageFacts } from './SimilarTypes';

const facts = (p: Partial<PassageFacts>): PassageFacts => ({
  range: { startVerseId: 1, endVerseId: 1 },
  language: 'en',
  text: '',
  strongs: [],
  topics: [],
  ...p,
});

describe('explainMatch', () => {
  it('shared lemma, minus the frequent set', () => {
    const a = facts({ strongs: [{ strongs: 'G25', lemma: 'agapao' }, { strongs: 'G3588' }] });
    const b = facts({ strongs: [{ strongs: 'G3588' }, { strongs: 'G25', gloss: 'to love' }, { strongs: 'G1' }] });
    expect(explainMatch(a, b, { frequentStrongs: new Set(['G3588']) })).toEqual([
      { kind: 'lemma', strongs: 'G25', lemma: 'agapao', gloss: 'to love' },
    ]);
    expect(explainMatch(a, b)).toHaveLength(2);
  });

  it('shared topics, case-insensitive, source from b', () => {
    const a = facts({ topics: [{ label: 'Love', source: 'naves' }] });
    const b = facts({ topics: [{ label: 'love', source: 'torrey' }, { label: 'Faith', source: 'tag' }] });
    expect(explainMatch(a, b)).toEqual([{ kind: 'topic', label: 'love', source: 'torrey' }]);
  });

  it('words: stems match across archaic forms, stop words dropped, b surface form shown', () => {
    const a = facts({ text: 'For God so loved the world, that he gave' });
    const b = facts({ text: 'Thou shalt love the LORD thy God' });
    const r = explainMatch(a, b);
    expect(r).toEqual([{ kind: 'words', words: ['love', 'God'] }]);
  });

  it('loved/loveth share a stem', () => {
    const r = explainMatch(facts({ text: 'he loved us' }), facts({ text: 'he that loveth not' }));
    expect(r).toEqual([{ kind: 'words', words: ['loveth'] }]);
  });

  it('Spanish words', () => {
    const r = explainMatch(
      facts({ language: 'es', text: 'Porque de tal manera amó Dios al mundo' }),
      facts({ language: 'es', text: 'El mundo no conoció a Dios' }),
    );
    expect(r).toEqual([{ kind: 'words', words: ['mundo', 'Dios'] }]);
  });

  it('language without a stemmer compares folded exact words', () => {
    const r = explainMatch(
      facts({ language: 'xx', text: 'Kalos Logos' }),
      facts({ language: 'xx', text: 'logos kalós theos' }),
    );
    expect(r).toEqual([{ kind: 'words', words: ['logos', 'kalós'] }]);
  });

  it('honours maxWords and orders lemma, topic, words; caps at 4', () => {
    const a = facts({
      text: 'alpha beta gamma delta',
      strongs: [{ strongs: 'G1' }, { strongs: 'G2' }],
      topics: [{ label: 'T1', source: 'tag' }, { label: 'T2', source: 'tag' }],
    });
    const r = explainMatch(a, { ...a }, { maxWords: 2 });
    expect(r.map((x) => x.kind)).toEqual(['lemma', 'lemma', 'topic', 'topic']);
    const only = explainMatch(facts({ text: a.text }), facts({ text: a.text }), { maxWords: 2 });
    expect(only).toEqual([{ kind: 'words', words: ['alpha', 'beta'] }]);
  });

  it('empty facts give []', () => {
    expect(explainMatch(facts({}), facts({}))).toEqual([]);
  });
});
