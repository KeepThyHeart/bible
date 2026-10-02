import { describe, it, expect } from 'vitest';
import { FSI, LRI, RLI, PDI, isolate, isolateParams, isolateMessageParams, simpleMessageArgs, isolateReference, stripBidiControls, hasBidiControls } from './bidi';

describe('isolate', () => {
  it('wraps in FSI by default and LRI/RLI on request', () => {
    expect(isolate('KJV')).toBe(`${FSI}KJV${PDI}`);
    expect(isolate('KJV', 'ltr')).toBe(`${LRI}KJV${PDI}`);
    expect(isolate('يوحنا', 'rtl')).toBe(`${RLI}يوحنا${PDI}`);
  });

  it('leaves empty strings alone and never double-wraps', () => {
    expect(isolate('')).toBe('');
    expect(isolate(isolate('KJV'))).toBe(`${FSI}KJV${PDI}`);
  });
});

describe('stripBidiControls', () => {
  it('removes isolates, embeddings, overrides and marks', () => {
    const dirty = `‮abc‬ ${FSI}يوحنا ٣:١٦${PDI}‎‏؜`;
    expect(stripBidiControls(dirty)).toBe('abc يوحنا ٣:١٦');
    expect(hasBidiControls(dirty)).toBe(true);
    expect(hasBidiControls('plain')).toBe(false);
  });

  it('round-trips isolate()', () => {
    expect(stripBidiControls(isolate('John 3:16-18'))).toBe('John 3:16-18');
  });
});

describe('isolateParams', () => {
  it('returns the same object in an LTR UI', () => {
    const p = { name: 'KJV', count: 3 };
    expect(isolateParams(p, 'ltr')).toBe(p);
  });

  it('isolates string params only in an RTL UI', () => {
    const p = { name: 'KJV', count: 3, empty: '', flag: true };
    const out = isolateParams(p, 'rtl');
    expect(out).not.toBe(p);
    expect(out).toEqual({ name: `${FSI}KJV${PDI}`, count: 3, empty: '', flag: true });
    expect(p.name).toBe('KJV'); // input not mutated
  });

  it('honours skip and already-isolated values', () => {
    const pre = isolate('x', 'ltr');
    const out = isolateParams({ a: 'A', b: 'B', c: pre }, 'rtl', ['b']);
    expect(out).toEqual({ a: `${FSI}A${PDI}`, b: 'B', c: pre });
  });

  it('returns the same object when nothing needed isolating', () => {
    const p = { n: 1 };
    expect(isolateParams(p, 'rtl')).toBe(p);
  });
});

describe('isolateReference', () => {
  it('wraps a formatted reference as one unit', () => {
    expect(isolateReference('3:16-18', 'ltr')).toBe(`${LRI}3:16-18${PDI}`);
    expect(isolateReference('يوحنا ٣:١٦')).toBe(`${FSI}يوحنا ٣:١٦${PDI}`);
  });
});

describe('isolateMessageParams', () => {
  it('isolates only simple {name} args in an RTL UI', () => {
    const msg = '{count, plural, one {# verse in {book}} other {# verses in {book}}} ({g, select, a {A} other {B}})';
    const out = isolateMessageParams(msg, { count: 2, book: 'John', g: 'a', lng: 'ar' }, 'rtl');
    expect(out).toEqual({ count: 2, book: `${FSI}John${PDI}`, g: 'a', lng: 'ar' });
  });
  it('is a no-op in LTR or without placeholders', () => {
    const p = { book: 'John' };
    expect(isolateMessageParams('{book}', p, 'ltr')).toBe(p);
    expect(isolateMessageParams('no args', p, 'rtl')).toBe(p);
  });
  it('lists simple args', () => {
    expect([...simpleMessageArgs('Open {name} in { pane }; {n, number}')]).toEqual(['name', 'pane']);
  });
});
