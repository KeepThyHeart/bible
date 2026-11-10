import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/diff.ts';
import type { PageSnapshot, RawNode } from '../src/types.ts';

const snap = (children: RawNode[], over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: 'http://h/a', title: 'T', vw: 1000, vh: 700, focus: 'body',
  root: { role: 'page', children }, nextRef: 100, sigs: {}, ...over,
});
const btn = (i: number, name = `B${i}`): RawNode => ({ ref: `r${i}`, role: 'button', name });

/** 30 parents with one added child each, so nothing folds. */
function spread() {
  const parents = (withKid: boolean) => snap(Array.from({ length: 30 }, (_, i) => ({
    ref: `p${i}`, role: 'group', name: `g${i}`, children: withKid ? [btn(i + 1)] : undefined,
  })));
  return { before: parents(false), after: parents(true) };
}

describe('diffSnapshots', () => {
  it('says no changes for identical snapshots', () => {
    expect(diffSnapshots(snap([btn(1)]), snap([btn(1)]))).toEqual(['no changes']);
  });

  it('handles a missing earlier snapshot', () => {
    const out = diffSnapshots(undefined, snap([btn(1)]));
    expect(out[0]).toContain('page "T"');
    expect(out[1]).toContain('no earlier snapshot');
  });

  it('reports url, title, focus and viewport changes', () => {
    const out = diffSnapshots(snap([]), snap([], { url: 'http://h/b?q=1', title: 'U', focus: 'r3', vw: 500 }));
    expect(out).toEqual(['url: /a → /b?q=1', 'title: "U"', 'focus: body → r3', 'viewport: 500x700']);
  });

  it('shows an added subtree as root, up to 3 children and the inside count', () => {
    const dialog: RawNode = { ref: 'r9', role: 'dialog', name: 'Settings', children: [btn(10), btn(11), btn(12), btn(13), btn(14)] };
    const out = diffSnapshots(snap([btn(1)]), snap([btn(1), dialog]));
    expect(out).toEqual([
      '+ [r9] dialog "Settings" (+5 inside)',
      '    [r10] button "B10"',
      '    [r11] button "B11"',
      '    [r12] button "B12"',
    ]);
  });

  it('shows all children of a small added subtree', () => {
    const dialog: RawNode = { ref: 'r9', role: 'dialog', children: [btn(10), btn(11)] };
    const out = diffSnapshots(snap([]), snap([dialog]));
    expect(out).toEqual(['+ [r9] dialog (+2 inside)', '    [r10] button "B10"', '    [r11] button "B11"']);
  });

  it('shows a removed subtree by its top only', () => {
    const dialog: RawNode = { ref: 'r9', role: 'dialog', name: 'Settings', children: [btn(10), btn(11)] };
    expect(diffSnapshots(snap([dialog]), snap([]))).toEqual(['- [r9] dialog "Settings" (+2 inside)']);
  });

  it('reports value changes on a ref node', () => {
    const a = snap([{ ref: 'r2', role: 'searchbox', name: 'Search', value: 'lo' }]);
    const b = snap([{ ref: 'r2', role: 'searchbox', name: 'Search', value: 'love' }]);
    expect(diffSnapshots(a, b)).toEqual(['~ [r2] searchbox "Search": =\"lo\" → =\"love\"']);
  });

  it('reports state changes with + and -', () => {
    const a = snap([{ ref: 'r2', role: 'checkbox', name: 'On', states: ['unchecked', 'focused'] }]);
    const b = snap([{ ref: 'r2', role: 'checkbox', name: 'On', states: ['checked', 'disabled'] }]);
    const [line] = diffSnapshots(a, b);
    expect(line).toBe('~ [r2] checkbox "On": +checked +disabled -unchecked -focused');
  });

  it('reports name changes', () => {
    const out = diffSnapshots(snap([btn(1, 'Open')]), snap([btn(1, 'Close')]));
    expect(out).toEqual(['~ [r1] button: name "Open" → "Close"']);
  });

  it('reports text changes by parent and position', () => {
    const mk = (t: string) => snap([{ ref: 'r1', role: 'main', children: [{ role: 'text', name: t }] }]);
    expect(diffSnapshots(mk('one'), mk('two'))).toEqual(['~ "two" (was "one")']);
  });

  it('folds many changes under one parent into one line', () => {
    const mk = (suffix: string) => snap([{ ref: 'r1', role: 'list', children: Array.from({ length: 6 }, (_, i) => btn(i + 2, `n${i}${suffix}`)) }]);
    const out = diffSnapshots(mk('a'), mk('b'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^~ \[r1\] list: 6 changed; first: /);
  });

  it('does not fold up to the fold limit', () => {
    const mk = (suffix: string) => snap([{ ref: 'r1', role: 'list', children: Array.from({ length: 4 }, (_, i) => btn(i + 2, `n${i}${suffix}`)) }]);
    expect(diffSnapshots(mk('a'), mk('b'))).toHaveLength(4);
  });

  it('counts added and removed in the fold summary', () => {
    const a = snap([{ ref: 'r1', role: 'list', children: [btn(2), btn(3), btn(4)] }]);
    const b = snap([{ ref: 'r1', role: 'list', children: [btn(5), btn(6), btn(7), btn(8), btn(9, 'x')] }]);
    expect(diffSnapshots(a, b)[0]).toMatch(/^~ \[r1\] list: \+5, -3; first: /);
  });

  it('caps the output and counts the rest', () => {
    const { before, after } = spread();
    const out = diffSnapshots(before, after);
    expect(out).toHaveLength(13);
    expect(out[12]).toBe('… +18 more changes (snapshot)');
  });

  it('counts head lines against the cap', () => {
    const { before, after } = spread();
    after.title = 'X';
    const out = diffSnapshots(before, after, { max: 3 });
    expect(out[0]).toBe('title: "X"');
    expect(out).toHaveLength(4);
    expect(out[3]).toMatch(/^… \+\d+ more changes/);
  });
});
