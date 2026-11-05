import { describe, expect, it } from 'vitest';
import { findNodes, headerLine, nodeLine, renderSnapshot, renderTree } from '../src/render.ts';
import type { PageSnapshot, RawNode } from '../src/types.ts';

const page = (...children: RawNode[]): RawNode => ({ role: 'page', children });
const btn = (i: number): RawNode => ({ ref: `r${i}`, role: 'button', name: `B${i}` });

describe('nodeLine', () => {
  it('prints text nodes as a quoted string', () => {
    expect(nodeLine({ role: 'text', name: 'Hello "x"' })).toBe('"Hello \\"x\\""');
  });
  it('prints ref, role and name', () => {
    expect(nodeLine({ ref: 'r12', role: 'button', name: 'Search' })).toBe('[r12] button "Search"');
  });
  it('omits the ref when there is none', () => {
    expect(nodeLine({ role: 'list' })).toBe('list');
  });
  it('prints the heading level', () => {
    expect(nodeLine({ ref: 'r7', role: 'heading', level: 2, name: 'John 3' })).toBe('[r7] heading/2 "John 3"');
  });
  it('prints values, including an empty one', () => {
    expect(nodeLine({ ref: 'r3', role: 'textbox', name: 'Query', value: 'love' })).toBe('[r3] textbox "Query" ="love"');
    expect(nodeLine({ ref: 'r3', role: 'textbox', value: '' })).toBe('[r3] textbox =""');
  });
  it('prints states after the name', () => {
    expect(nodeLine({ ref: 'r5', role: 'checkbox', name: 'On', states: ['checked', 'disabled'] })).toBe('[r5] checkbox "On" checked disabled');
  });
});

describe('renderTree', () => {
  it('indents children', () => {
    const lines = renderTree(page({ ref: 'r1', role: 'dialog', name: 'D', children: [btn(2)] }));
    expect(lines).toEqual(['[r1] dialog "D"', '  [r2] button "B2"']);
  });

  it('collapses long lists into a count with a role summary', () => {
    const kids = Array.from({ length: 20 }, (_, i) => btn(i + 2));
    const lines = renderTree(page({ ref: 'r1', role: 'list', children: kids }));
    expect(lines).toContain('  … +10 more (button×10)');
    expect(lines).toContain('  [r2] button "B2"');
    expect(lines).toContain('  [r10] button "B10"');
    expect(lines).not.toContain('  [r11] button "B11"');
    expect(lines[lines.length - 1]).toBe('  [r21] button "B21"'); // the last item is kept
  });

  it('does not collapse lists up to listMax + 2', () => {
    const kids = Array.from({ length: 12 }, (_, i) => btn(i + 2));
    const lines = renderTree(page({ ref: 'r1', role: 'list', children: kids }));
    expect(lines.some(l => l.includes('more'))).toBe(false);
    expect(lines).toHaveLength(13);
  });

  it('summarises the most common roles first', () => {
    const kids: RawNode[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ ref: `r${i}`, role: 'link', name: 'l' })),
      ...Array.from({ length: 5 }, (_, i) => ({ ref: `s${i}`, role: 'button', name: 'b' })),
      ...Array.from({ length: 5 }, () => ({ role: 'text', name: 't' })),
    ];
    const lines = renderTree(page({ role: 'list', children: kids }), { listMax: 3 });
    expect(lines.find(l => l.includes('more'))).toMatch(/\(link×\d+, /);
  });

  it('stops at the line budget and counts what was left out', () => {
    const kids = Array.from({ length: 10 }, (_, i) => btn(i + 1));
    const lines = renderTree(page(...kids), { max: 4 });
    expect(lines.slice(0, 4)).toHaveLength(4);
    expect(lines[4]).toBe('… +6 more nodes (snapshot rN for a part, --max N, --all)');
  });

  it('counts nested nodes in the left-out total', () => {
    const lines = renderTree(page(btn(1), { ref: 'r2', role: 'list', children: [btn(3), btn(4)] }), { max: 1 });
    expect(lines[1]).toContain('+3 more nodes');
  });

  it('summarises content below the depth limit', () => {
    const tree = page({ ref: 'r1', role: 'main', children: [{ ref: 'r2', role: 'list', children: [btn(3), btn(4)] }] });
    const lines = renderTree(tree, { depth: 1 });
    expect(lines).toEqual(['[r1] main', '  [r2] list (+2 inside)']);
  });

  it('prints everything with all', () => {
    const kids = Array.from({ length: 300 }, (_, i) => btn(i + 1));
    const lines = renderTree(page(...kids), { all: true });
    expect(lines).toHaveLength(300);
    expect(lines.some(l => l.includes('more'))).toBe(false);
  });

  it('renders a scoped (non-page) root as itself', () => {
    expect(renderTree({ ref: 'r9', role: 'dialog', children: [btn(1)] })[0]).toBe('[r9] dialog');
  });
});

const snap = (url: string, focus = 'body'): PageSnapshot => ({
  url, title: 'Bible', vw: 1280, vh: 720, focus, root: page(), nextRef: 1, sigs: {},
});

describe('headerLine / renderSnapshot', () => {
  it('shows title, path, viewport', () => {
    expect(headerLine(snap('http://127.0.0.1:1234/read/John.3?x=1#v2'))).toBe('page "Bible" /read/John.3?x=1#v2 1280x720');
  });
  it('shows focus unless body', () => {
    expect(headerLine(snap('http://h/a', 'r4'))).toBe('page "Bible" /a 1280x720 focus=r4');
  });
  it('shortens file urls', () => {
    expect(headerLine(snap('file:///a/b/c/index.html#/x'))).toBe('page "Bible" c/index.html#/x 1280x720');
  });
  it('keeps an unparsable url', () => {
    expect(headerLine(snap('not a url'))).toContain('not a url');
  });
  it('marks an empty page', () => {
    expect(renderSnapshot(snap('http://h/')).split('\n')[1]).toBe('(empty)');
  });
});

describe('findNodes', () => {
  const tree = page({
    ref: 'r1', role: 'dialog', name: 'Settings', children: [
      { ref: 'r2', role: 'button', name: 'Close settings' },
      { ref: 'r3', role: 'textbox', name: 'Name', value: 'My Settings', states: ['focused'] },
      { role: 'text', name: 'Settings are saved' },
    ],
  }, { ref: 'r4', role: 'link', name: 'Home' });

  it('matches name and value case-insensitively, with the nearest ref ancestor as context', () => {
    const out = findNodes(tree, 'SETTINGS').split('\n');
    expect(out[0]).toBe('[r1] dialog "Settings"');
    expect(out[1]).toBe('[r2] button "Close settings"  < [r1] dialog "Settings"');
    expect(out[2]).toBe('[r3] textbox "Name" ="My Settings" focused  < [r1] dialog "Settings"');
    expect(out[3]).toBe('"Settings are saved"  < [r1] dialog "Settings"');
  });
  it('filters by role', () => {
    expect(findNodes(tree, 'settings', 'button')).toBe('[r2] button "Close settings"  < [r1] dialog "Settings"');
  });
  it('reports no match', () => {
    expect(findNodes(tree, 'zzz')).toBe('no match for "zzz"');
  });
  it('limits and counts the rest', () => {
    const many = page(...Array.from({ length: 20 }, (_, i) => btn(i + 1)));
    const out = findNodes(many, 'B', undefined, 5).split('\n');
    expect(out).toHaveLength(6);
    expect(out[5]).toBe('… +15 more');
  });
});
