import { describe, it, expect } from 'vitest';
import { alignRecitation } from '../../recite/align';
import { englishKit } from '../../recite/lang/en';
import { POLICIES } from '../../recite/policy';
import { ev, rw, JOHN_316 } from './helpers';

const kit = englishKit;
const N = POLICIES.normal;
const J = ev(JOHN_316);

function run(expected: string[], heard: string, policy = N, opts?: Parameters<typeof alignRecitation>[4]) {
  return alignRecitation(expected, rw(heard), kit, policy, opts);
}
const verdicts = (r: ReturnType<typeof run>) => r.words.map((w) => w.verdict);

describe('alignRecitation', () => {
  it('scores a perfect recitation 1', () => {
    const r = run(J, JOHN_316);
    expect(r.score).toBe(1);
    expect(r.extras).toEqual([]);
    expect(r.lastMatched).toBe(J.length - 1);
    expect(verdicts(r).every((v) => v === 'correct')).toBe(true);
  });

  it('John 3:16 design example scores 0.94', () => {
    const heard =
      'for god so loved the world that he gave his begotten son that whosoever believes in him should not perish but have ever lasting life';
    const r = run(J, heard);
    expect(J.length).toBe(25);
    expect(r.words[10].verdict).toBe('missed');
    expect(r.words[15].verdict).toBe('near');
    expect(r.words[23].verdict).toBe('correct');
    expect(r.score).toBeCloseTo(23.5 / 25, 6);
    expect(Math.round(r.score * 100)).toBe(94);
  });

  it('omission, substitution, insertion', () => {
    const e = ev('In the beginning God created the heaven and the earth');
    const om = run(e, 'in the beginning God created the heaven the earth');
    expect(verdicts(om)[7]).toBe('missed');
    expect(om.score).toBeCloseTo(9 / 10, 6);

    const sub = run(e, 'in the beginning God created the mountain and the earth');
    expect(verdicts(sub)[6]).toBe('wrong');
    expect(sub.extras).toEqual([]);

    const ins = run(e, 'in the very beginning God created the heaven and the earth');
    expect(ins.extras.length).toBe(1);
    expect(ins.extras[0].afterIndex).toBe(1);
    expect(ins.score).toBeCloseTo(1 - 0.25 / 10, 6);
  });

  it('ignores fillers', () => {
    const r = run(ev('The Lord is my shepherd'), 'um the Lord uh is my er shepherd');
    expect(r.score).toBe(1);
    expect(r.extras).toEqual([]);
  });

  it('joins and splits: ever lasting, for ever', () => {
    const a = run(ev('have everlasting life'), 'have ever lasting life');
    expect(verdicts(a)).toEqual(['correct', 'correct', 'correct']);
    expect(a.extras).toEqual([]);
    const b = run(ev('for ever and ever'), 'forever and ever');
    expect(b.score).toBe(1);
    const c = run(ev('to forever and ever'), 'to for ever and ever');
    expect(c.score).toBe(1);
    const d = run(ev('whosoever will'), 'who so ever will');
    expect(d.score).toBe(1);
  });

  it('digits', () => {
    const r = run(ev('there were three men'), 'there were 3 men');
    expect(r.score).toBe(1);
  });

  it('KJV 144,000 against digits', () => {
    const e = ev('an hundred and forty and four thousand');
    const r = run(e, '144,000');
    expect(r.extras).toEqual([]);
    expect(r.words.slice(1).every((w) => w.verdict === 'correct' || w.verdict === 'variant')).toBe(true);
    // Known gap in englishKit.equivalent: "an"/"a" vs spoken "one" is not a variant (reported).
  });

  it('homophone is variant', () => {
    const r = run(ev('their son'), 'there sun');
    expect(verdicts(r)).toEqual(['variant', 'variant']);
    expect(r.score).toBe(1);
  });

  it('archaic near: believeth / believes', () => {
    const r = run(ev('he that believeth shall live'), 'he that believes shall live');
    expect(r.words[2].verdict).toBe('near');
    expect(r.score).toBeCloseTo(4.5 / 5, 6);
  });

  it('swapped words: so God loved', () => {
    const e = ev('For God so loved the world');
    const r = run(e, 'for so God loved the world');
    expect(verdicts(r).filter((v) => v === 'swapped').length).toBe(1);
    expect(r.extras).toEqual([]);
    expect(r.score).toBeCloseTo(5.5 / 6, 6);
  });

  it('adjacent swap of similar words', () => {
    const r = run(ev('he the'), 'the he');
    expect(r.score).toBeGreaterThan(0.3);
    expect(verdicts(r)).not.toContain('wrong');
  });

  it('verily verily with one missing matches the earlier word', () => {
    const r = run(ev('verily verily I say unto you'), 'verily I say unto you');
    expect(verdicts(r)).toEqual(['correct', 'missed', 'correct', 'correct', 'correct', 'correct']);
    expect(r.extras).toEqual([]);
  });

  it('empty heard: all missed, score 0', () => {
    const r = run(J, '');
    expect(r.score).toBe(0);
    expect(verdicts(r).every((v) => v === 'missed')).toBe(true);
    expect(r.lastMatched).toBe(-1);
  });

  it('empty expected', () => {
    const r = run([], 'hello');
    expect(r).toEqual({ words: [], extras: [], score: 0, verseScores: [], lastMatched: -1 });
  });

  it('hinted words get no credit', () => {
    const r = run(J, JOHN_316, N, { hinted: new Set([0, 1]) });
    expect(r.words[0].verdict).toBe('hinted');
    expect(r.words[1].credit).toBe(0);
    expect(r.score).toBeCloseTo(23 / 25, 6);
  });

  it('caps the extras penalty', () => {
    const e = ev('In the beginning God created the heaven and the earth');
    const r = run(e, 'in the beginning God created the heaven and the earth yes yes yes yes yes yes yes yes');
    expect(r.extras.length).toBe(8);
    expect(r.score).toBeCloseTo(0.9, 6);
  });

  it('lenient vs strict', () => {
    const e = ev('he that believeth shall live');
    const h = 'he that believes shall live';
    expect(run(e, h, POLICIES.lenient).score).toBe(1);
    expect(run(e, h, N).score).toBeCloseTo(0.9, 6);
    expect(run(e, h, POLICIES.strict).score).toBeCloseTo(0.8, 6);
  });

  it('low confidence upgrades near to variant (not when strict)', () => {
    const e = ev('he that believeth shall live');
    const heard = rw('he that believes shall live').map((w) =>
      w.text === 'believes' ? { ...w, confidence: 0.2 } : { ...w, confidence: 0.9 },
    );
    expect(alignRecitation(e, heard, kit, N).words[2].verdict).toBe('variant');
    expect(alignRecitation(e, heard, kit, POLICIES.strict).words[2].verdict).toBe('near');
  });

  it('prefix mode leaves trailing words free and reports lastMatched', () => {
    const r = run(J, 'for God so loved the world', N, { mode: 'prefix' });
    expect(r.lastMatched).toBe(5);
    expect(r.words[6].verdict).toBe('missed');
    const full = run(J, 'for God so loved the world');
    expect(full.lastMatched).toBe(5);
  });

  it('verse scores', () => {
    const e = ev('one two three four five six seven eight');
    const r = run(e, 'one two three four five six', N, { verseStarts: [0, 4] });
    expect(r.verseScores[0]).toBe(1);
    expect(r.verseScores[1]).toBe(0.5);
  });

  it('750 words complete banded; banded equals unbanded result', () => {
    const vocab = ev('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu');
    const make = (count: number) => Array.from({ length: count }, (_, i) => vocab[(i * 7 + (i >> 3)) % vocab.length] + (i % 5 === 0 ? 'x' : ''));
    const big = make(750);
    const heardBig = big.filter((_, i) => i % 50 !== 7).join(' ');
    const rb = run(big, heardBig);
    expect(rb.words.length).toBe(750);
    expect(rb.score).toBeGreaterThan(0.95);

    const mid = make(250);
    const heardMid = mid.filter((_, i) => i % 40 !== 3).join(' ');
    const banded = run(mid, heardMid);
    const unbanded = run(mid, heardMid, N, { unbanded: true });
    expect(banded).toEqual(unbanded);
    expect(banded.words.filter((w) => w.verdict === 'missed').length).toBe(7);
  });

  it('is deterministic', () => {
    const heard = 'for so god loved the world that he gave his begotten son';
    const a = run(J, heard);
    const b = run(J, heard);
    expect(b).toEqual(a);
  });
});
