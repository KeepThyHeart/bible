import type { RecognizedWord } from '../../recite/types';

export function rw(text: string, confidence?: number): RecognizedWord[] {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => (confidence === undefined ? { text: w } : { text: w, confidence }));
}

export function ev(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/** Small seeded generator for deterministic tests. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const JOHN_316 =
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';
