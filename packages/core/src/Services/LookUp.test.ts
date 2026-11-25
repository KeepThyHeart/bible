import { describe, it, expect } from 'vitest';
import {
  createLookUpRegistry, lookUpAll, isLookUpCandidate, normalizeLookUpText, orderLookUpGroups,
  searchDictionariesForWord, strongsEntryKey, type LookUpDictionary, type LookUpGroup,
} from './LookUp';

const entry = (key: string, word = key) => ({ entryKey: key, word, definition: `<b>${word}</b> means something` });

function dict(abbr: string, name: string, entries: string[], strongs = false): LookUpDictionary {
  return {
    abbreviation: abbr, name, strongs,
    repo: {
      searchEntries: (q) => entries.filter(e => e.toLowerCase().includes(q.toLowerCase().slice(0, 4))).map(e => entry(e)),
      getEntryByKey: (k) => (k === '00026' ? entry('00026', 'agape') : undefined),
    },
  };
}

describe('look up text', () => {
  it('normalizes edge punctuation and spacing', () => {
    expect(normalizeLookUpText('  “walked,”  ')).toBe('walked');
    expect(normalizeLookUpText('the   Lord')).toBe('the Lord');
  });
  it('accepts a word or short phrase and refuses a sentence', () => {
    expect(isLookUpCandidate('love')).toBe(true);
    expect(isLookUpCandidate('Son of man')).toBe(true);
    expect(isLookUpCandidate('For God so loved the world')).toBe(false);
    expect(isLookUpCandidate('   ')).toBe(false);
  });
  it('maps Strong\'s numbers to lexicon keys', () => {
    expect(strongsEntryKey('G26')).toBe('00026');
    expect(strongsEntryKey('h0430')).toBe('00430');
    expect(strongsEntryKey('Hello')).toBeUndefined();
  });
});

describe('providers', () => {
  it('asks every provider and survives one failing', async () => {
    const reg = createLookUpRegistry();
    reg.register({ id: 'a', label: 'A', lookUp: async () => [{ providerId: 'a', sourceId: 'x', sourceName: 'X', entries: [{ key: '1', title: 'one' }] }] });
    reg.register({ id: 'b', label: 'B', lookUp: async () => { throw new Error('down'); } });
    const groups = await lookUpAll(reg, { text: 'one' });
    expect(groups.map(g => g.sourceId)).toEqual(['x']);
  });

  it('puts the Strong\'s lexicon first for a tagged word and drops empty groups', () => {
    const groups: LookUpGroup[] = [
      { providerId: 'd', sourceId: 'W', sourceName: 'Webster', entries: [{ key: 'a', title: 'a' }] },
      { providerId: 'd', sourceId: 'E', sourceName: 'Empty', entries: [] },
      { providerId: 'd', sourceId: 'G', sourceName: 'Greek', strongs: true, entries: [{ key: 'b', title: 'b' }] },
    ];
    expect(orderLookUpGroups(groups, { text: 'x', strongs: 'G26' }).map(g => g.sourceId)).toEqual(['G', 'W']);
    expect(orderLookUpGroups(groups, { text: 'x' }).map(g => g.sourceId)).toEqual(['W', 'G']);
  });
});

describe('searchDictionariesForWord', () => {
  const dicts = [
    dict('Easton', 'Easton', ['WALK', 'WALKED']),
    dict('StrongsGreek', "Strong's Greek", ['agape'], true),
    dict('StrongsHebrew', "Strong's Hebrew", ['ahav'], true),
  ];

  it('lists each dictionary with its hits, once per entry', () => {
    const groups = searchDictionariesForWord(dicts, { text: 'walking' });
    expect(groups.find(g => g.sourceId === 'Easton')?.entries.map(e => e.key)).toEqual(['WALK', 'WALKED']);
  });

  it('for a Greek-tagged word shows the Strong\'s entry first, in the Greek lexicon only', () => {
    const groups = searchDictionariesForWord(dicts, { text: 'agape', strongs: 'G26' });
    expect(groups[0].sourceId).toBe('StrongsGreek');
    expect(groups[0].entries[0]).toMatchObject({ key: '00026', title: 'agape' });
    expect(groups.some(g => g.sourceId === 'StrongsHebrew')).toBe(false);
  });

  it('strips markup from the snippet', () => {
    const groups = searchDictionariesForWord([dicts[0]], { text: 'walk' });
    expect(groups[0].entries[0].snippet).toBe('WALK means something');
  });
});
