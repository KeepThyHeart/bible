import type { HymnLibraryEntry } from '../types';

/** A small hymn library for the notes tests. */
export const TH = 'Trinity Hymnal 1990';

export const LIBRARY: HymnLibraryEntry[] = [
  { id: 'amazing-grace', title: 'Amazing Grace', firstLine: 'Amazing grace! how sweet the sound', hymnals: [{ hymnal: TH, number: '460' }], verseCount: 6, hasRefrain: false },
  { id: 'it-is-well', title: 'It Is Well with My Soul', firstLine: 'When peace, like a river, attendeth my way', hymnals: [{ hymnal: TH, number: '691' }], verseCount: 4, hasRefrain: true },
  { id: 'grace-greater', title: 'Grace Greater than Our Sin', firstLine: 'Marvelous grace of our loving Lord', hymnals: [{ hymnal: TH, number: '23' }], verseCount: 4, hasRefrain: true },
  { id: 'holy-holy-holy', title: 'Holy, Holy, Holy! Lord God Almighty', firstLine: 'Holy, holy, holy! Lord God Almighty!', hymnals: [{ hymnal: TH, number: '100' }, { hymnal: 'Psalter Hymnal', number: '23' }], verseCount: 4, hasRefrain: false },
  { id: 'rock-of-ages', title: 'Rock of Ages', altTitles: ['Rock of Ages, Cleft for Me'], firstLine: 'Rock of Ages, cleft for me', hymnals: [{ hymnal: TH, number: '499' }], verseCount: 3, hasRefrain: false },
];
