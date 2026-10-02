import { describe, it, expect } from 'vitest';
import { ReferenceEngine } from '../engine';
import { normalizeText } from '../normalize';
import { ReferenceParser } from '../../Services/ReferenceParser';

const en = () => ReferenceEngine.create({ locales: ['en'] });

describe('review findings (round 2)', () => {
  it('a list never swallows the next numbered book', () => {
    expect(en().scan('Read Rom 8:28; 1 Cor 13:4').map((m) => m.text)).toEqual(['Rom 8:28', '1 Cor 13:4']);
    expect(en().scan('Read Rom 8:28, 1 Cor 13:4').map((m) => m.text)).toEqual(['Rom 8:28', '1 Cor 13:4']);
    expect(en().scan('John 3:16, 18').map((m) => m.text)).toEqual(['John 3:16', ', 18']);
  });

  it('isReference stays exact: words glued to numbers are searches', () => {
    const p = new ReferenceParser();
    for (const q of ['web3', 'hope3', 'joy4', 'king3', 'love1', 'son2', 'tim3']) expect(p.isReference(q), q).toBe(false);
    expect(p.isReference('Heb3')).toBe(true);
  });

  it('prefixes extend book names, not aliases or ordinal words', () => {
    expect(en().parse('the 3').ok).toBe(false);
    expect(en().parse('third 3:16').ok).toBe(false);
    expect(en().parse('Deuter 6:4')).toMatchObject({ ok: true, book: 5, via: 'prefix' });
  });

  it('normalises long text in linear time', () => {
    const text = 'In the beginning God created the heaven and the earth. '.repeat(10000); // ~560 KB
    const t0 = Date.now();
    normalizeText(text);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
