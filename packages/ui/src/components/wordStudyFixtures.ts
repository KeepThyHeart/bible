import type { RenderingGroup, WordStudyOverview } from '@bible/core/browser';

export const group = (label: string, count: number, total = 100, key = label): RenderingGroup => ({
  label, key, count, share: count / total, members: [{ phrase: label, count }],
});

export const overviewFixture = (over: Partial<WordStudyOverview> = {}): WordStudyOverview => ({
  subject: { kind: 'strongs', label: 'agapao', strongs: 'G25', language: 'Greek' },
  entry: { word: 'ἀγαπάω', translit: 'agapaō', pronunciation: 'ag-ap-ah-o', sense: 'to love', lexiconRenderings: ['love', 'beloved'], source: 'strongs' },
  modules: [
    { module: 'KJV', name: 'King James', strongsTagged: true },
    { module: 'ESV', name: 'English Standard', strongsTagged: true },
  ],
  module: 'KJV',
  totals: { occurrences: 142, verses: 106 },
  bookCounts: { 43: 30, 62: 10 },
  forms: [group('love', 80), group('loved', 20)],
  morphology: [],
  family: [],
  semanticRange: null,
  ...over,
});
