/** A small built-in KJV passage list for the harness (public domain text). */

import type { VerseText } from '@bible/memory/core';
import type { LoopCard } from '@bible/memory/recite/handsFreeLoop';

export interface Passage {
  id: number;
  reference: string;
  spokenReference: string;
  verses: { label: string; text: string }[];
}

export const PASSAGES: Passage[] = [
  {
    id: 1,
    reference: 'John 3:16-17',
    spokenReference: 'John chapter 3, verses 16 to 17',
    verses: [
      { label: '3:16', text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
      { label: '3:17', text: 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.' },
    ],
  },
  {
    id: 2,
    reference: 'Psalm 23:1-3',
    spokenReference: 'Psalm 23, verses 1 to 3',
    verses: [
      { label: '23:1', text: 'The LORD is my shepherd; I shall not want.' },
      { label: '23:2', text: 'He maketh me to lie down in green pastures: he leadeth me beside the still waters.' },
      { label: '23:3', text: "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake." },
    ],
  },
  {
    id: 3,
    reference: 'Romans 8:28',
    spokenReference: 'Romans chapter 8, verse 28',
    verses: [
      { label: '8:28', text: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.' },
    ],
  },
  {
    id: 4,
    reference: 'Genesis 1:1-3',
    spokenReference: 'Genesis chapter 1, verses 1 to 3',
    verses: [
      { label: '1:1', text: 'In the beginning God created the heaven and the earth.' },
      { label: '1:2', text: 'And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.' },
      { label: '1:3', text: 'And God said, Let there be light: and there was light.' },
    ],
  },
  {
    id: 5,
    reference: '1 John 1:9',
    spokenReference: 'First John chapter 1, verse 9',
    verses: [
      { label: '1:9', text: 'If we confess our sins, he is faithful and just to forgive us our sins, and to cleanse us from all unrighteousness.' },
    ],
  },
];

export function versesOf(p: Passage): VerseText[] {
  return p.verses.map((v, i) => ({
    verseId: p.id * 100 + i,
    label: v.label,
    words: v.text.split(/\s+/).filter(Boolean),
    lines: null,
    psalmTitle: null,
    paragraphStart: false,
  }));
}

export function cardOf(p: Passage, remaining: number): LoopCard {
  return {
    cardId: p.id,
    passageId: p.id,
    reference: p.reference,
    spokenReference: p.spokenReference,
    language: 'en',
    verses: versesOf(p),
    contextWords: [],
    remaining,
  };
}
