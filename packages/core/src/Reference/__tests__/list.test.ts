import { describe, it, expect, beforeAll } from 'vitest';
import { ReferenceEngine } from '../engine';
import { loadReferenceLocales } from '../registry';
import { parseReferenceList } from '../list';
import { encodeRange } from './helpers';

beforeAll(async () => {
  await loadReferenceLocales(['zh-Hans']);
});

const en = () => ReferenceEngine.create({ locales: ['en'] });
const enc = (s: string, e = en()) => {
  const r = parseReferenceList(e, s);
  return { r, codes: r.items.map((i) => encodeRange(i.range)) };
};

describe('parseReferenceList', () => {
  it('single ranges', () => {
    expect(enc('John 3').codes).toEqual(['43:3']);
    expect(enc('John 3-5').codes).toEqual(['43:3-5']);
    expect(enc('John 3:16').codes).toEqual(['43:3:16']);
    const r = parseReferenceList(en(), 'John 3:16-4:5').items[0].range;
    expect(r.endChapter).toBe(4);
    expect(r.endVerse).toBe(5);
  });

  it('multi-book list with offsets', () => {
    const input = 'Ps 23; Rom 8:28-39; Gen 1-2';
    const { r, codes } = enc(input);
    expect(r.ok).toBe(true);
    expect(codes).toEqual(['19:23', '45:8:28-39', '1:1-2']);
    expect(r.items.map((i) => input.slice(i.start, i.end))).toEqual(['Ps 23', 'Rom 8:28-39', 'Gen 1-2']);
    expect(r.items.map((i) => i.text)).toEqual(['Ps 23', 'Rom 8:28-39', 'Gen 1-2']);
  });

  it('same-book list stays one group', () => {
    const { r, codes } = enc('John 3:16, 18; 4:1');
    expect(r.ok).toBe(true);
    expect(codes).toEqual(['43:3:16', '43:3:18', '43:4:1']);
    expect(new Set(r.items.map((i) => i.start)).size).toBe(1);
  });

  it('numbered books and whole book', () => {
    expect(enc('1 John 2; 3 John 1').codes).toEqual(['62:2', '64:1:1']);
    const w = enc('John');
    expect(w.r.ok).toBe(true);
    expect(w.r.items[0].range.wholeBook).toBe(true);
  });

  it('a bare-number piece after a comma never starts a new group ("Joh 3,16")', () => {
    // No German locale ships yet; English reads "3,16" as a list, but it must stay one group.
    const r = parseReferenceList(en(), 'John 3,16');
    expect(new Set(r.items.map((i) => i.start)).size).toBe(1);
    expect(r.items.every((i) => i.text === 'John 3,16')).toBe(true);
  });

  it('zh-Hans fullwidth semicolon', () => {
    const zh = ReferenceEngine.create({ locales: ['zh-Hans', 'en'] });
    const r = parseReferenceList(zh, 'John 3；Rom 8');
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(2);
  });

  it('bad input', () => {
    const reason = (s: string) => parseReferenceList(en(), s).errors[0]?.reason;
    expect(reason('Foo 3')).toBe('no-book');
    expect(reason('3:16')).toBe('no-book');
    expect(reason('John 3:16-10')).toBe('bad-numbers');
    expect(reason('Jude 2:1')).toBe('out-of-range');
    expect(reason('Ps 151')).toBe('out-of-range');
    expect(reason('')).toBe('empty');
    expect(parseReferenceList(en(), '').ok).toBe(false);
    expect(parseReferenceList(en(), '; John 3').ok).toBe(true);
    expect(parseReferenceList(en(), '; John 3').items).toHaveLength(1);
  });

  it('too many items', () => {
    const input = Array.from({ length: 51 }, () => 'Ps 23').join('; ');
    const r = parseReferenceList(en(), input);
    expect(r.ok).toBe(false);
    expect(r.items).toHaveLength(50);
    expect(r.errors.at(-1)?.reason).toBe('too-many');
  });

  it('mixed good and bad keeps the good items', () => {
    const r = parseReferenceList(en(), 'John 3; Foo 1; Ps 23');
    expect(r.ok).toBe(false);
    expect(r.items).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].text).toBe('Foo 1');
  });
});
