import { describe, it, expect } from 'vitest';
import { biasFor } from '../../recite/bias';
import { englishKit } from '../../recite/lang/en';
import { ev, seeded } from './helpers';

const VERSE = ev(
  'And Jesus went up into Jerusalem, and Peter said unto Moses, the LORD and God of Abraham and Isaac and Jacob spake with Israel.',
);
const CONTEXT = ev('Then Paul came to Antioch and the disciples of David blessed Barnabas.');

describe('biasFor', () => {
  it('none is empty', () => {
    expect(biasFor(VERSE, CONTEXT, englishKit, 'none', seeded(1))).toEqual({ phrases: [], level: 'none' });
  });

  it('names keeps capitalised non-stopword names, not LORD/God/I/O', () => {
    const r = biasFor(VERSE, CONTEXT, englishKit, 'names', seeded(1));
    const set = new Set(r.phrases.map((p) => p.toLowerCase()));
    for (const n of ['jesus', 'jerusalem', 'peter', 'moses', 'abraham', 'isaac', 'jacob', 'israel', 'paul', 'antioch', 'david', 'barnabas']) {
      expect(set.has(n)).toBe(true);
    }
    expect(set.has('lord')).toBe(false);
    expect(set.has('god')).toBe(false);
    expect(set.has('and')).toBe(false);
    expect(set.has('then')).toBe(false);
    expect(r.phrases.length).toBe(set.size);
  });

  it('names and vocabulary are never in passage order', () => {
    const names = biasFor(VERSE, CONTEXT, englishKit, 'names', seeded(7)).phrases.map((p) => p.toLowerCase());
    const inOrder = names.slice().sort((a, b) => VERSE.concat(CONTEXT).findIndex((w) => w.toLowerCase().startsWith(a)) - VERSE.concat(CONTEXT).findIndex((w) => w.toLowerCase().startsWith(b)));
    expect(names).not.toEqual(inOrder);

    const vocab = biasFor(VERSE, CONTEXT, englishKit, 'vocabulary', seeded(7)).phrases;
    const ordered: string[] = [];
    for (const w of VERSE.concat(CONTEXT)) {
      const f = w.toLowerCase().replace(/[^a-z]/g, '');
      if (!englishKit.isStopword(f) && !ordered.includes(f)) ordered.push(f);
    }
    expect(vocab.slice().sort()).toEqual(ordered.slice().sort());
    expect(vocab).not.toEqual(ordered);
  });

  it('only full contains stopwords', () => {
    const full = biasFor(VERSE, CONTEXT, englishKit, 'full', seeded(1)).phrases.join(' ').toLowerCase();
    expect(full).toContain('and jesus went up into');
    for (const lvl of ['names', 'vocabulary'] as const) {
      const ph = biasFor(VERSE, CONTEXT, englishKit, lvl, seeded(1)).phrases;
      for (const p of ph) expect(englishKit.isStopword(p.toLowerCase())).toBe(false);
    }
  });

  it('is deterministic for a seed', () => {
    const a = biasFor(VERSE, CONTEXT, englishKit, 'vocabulary', seeded(3));
    const b = biasFor(VERSE, CONTEXT, englishKit, 'vocabulary', seeded(3));
    expect(a).toEqual(b);
  });
});
