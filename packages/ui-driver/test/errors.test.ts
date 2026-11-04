import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { ErrorCollector, formatErrors } from '../src/errors.ts';

describe('ErrorCollector', () => {
  it('dedupes by kind+text, counting repeats and moving seq', () => {
    const c = new ErrorCollector();
    c.add('console', 'boom');
    c.add('console', 'other');
    const before = c.lastSeq();
    c.add('console', 'boom');
    expect(c.all()).toEqual([
      { seq: 2, kind: 'console', text: 'other', count: 1 },
      { seq: 3, kind: 'console', text: 'boom', count: 2 },
    ]);
    expect(c.since(before).map(e => e.text)).toEqual(['boom']);
    c.add('pageerror', 'boom');
    expect(c.all()).toHaveLength(3);
  });

  it('normalises text and truncates', () => {
    const c = new ErrorCollector();
    c.add('console', `  a   b\nsecond line ${'x'.repeat(300)}`);
    c.add('console', `${'y'.repeat(300)}`);
    const [a, b] = c.all();
    expect(a?.text).toBe('a b');
    expect(b?.text).toHaveLength(200);
    expect(b?.text.endsWith('…')).toBe(true);
  });

  it('ignores allow-listed noise', () => {
    const c = new ErrorCollector();
    c.add('console', 'Download the React DevTools for a better development experience');
    c.add('console', 'Electron Security Warning (Insecure Content-Security-Policy) blah');
    expect(c.all()).toEqual([]);
  });

  it('hides warnings unless asked, and clears', () => {
    const c = new ErrorCollector();
    c.add('warning', 'careful');
    c.add('http', '404 GET /x');
    expect(c.all().map(e => e.kind)).toEqual(['http']);
    expect(c.all({ warnings: true })).toHaveLength(2);
    expect(c.since(0, { warnings: true })).toHaveLength(2);
    c.clear();
    expect(c.all({ warnings: true })).toEqual([]);
  });

  it('caps distinct entries at 500, dropping the oldest', () => {
    const c = new ErrorCollector();
    for (let i = 0; i < 505; i++) c.add('console', `e${i}`);
    const all = c.all();
    expect(all).toHaveLength(500);
    expect(all[0]?.text).toBe('e5');
  });

  it('attach() maps page events to kinds', () => {
    const page = Object.assign(new EventEmitter(), { url: () => 'http://localhost:5173/read' });
    const c = new ErrorCollector();
    c.attach(page as unknown as Page);
    const msg = (type: string, text: string, url = '') => ({ type: () => type, text: () => text, location: () => ({ url, lineNumber: 7 }) });
    page.emit('console', msg('error', 'plain failure', 'http://localhost:5173/src/app.js?v=1'));
    page.emit('console', msg('error', 'The above error occurred in the <Foo> component:\n at Foo'));
    page.emit('console', msg('warning', 'deprecated'));
    page.emit('console', msg('log', 'ignored'));
    const err = new Error('kaput');
    err.stack = 'Error: kaput\n    at run (http://localhost:5173/assets/main.js:12:34)\n    at other (x.js:1:1)';
    page.emit('pageerror', err);
    page.emit('requestfailed', { method: () => 'POST', url: () => `http://localhost:5173/api/save?${'q'.repeat(60)}`, failure: () => ({ errorText: 'net::ERR_FAILED' }) });
    page.emit('response', { status: () => 500, url: () => 'http://localhost:5173/api/x', request: () => ({ method: () => 'GET' }) });
    page.emit('response', { status: () => 200, url: () => 'http://localhost:5173/ok', request: () => ({ method: () => 'GET' }) });
    const got = c.all({ warnings: true }).map(e => `${e.kind}|${e.text}`);
    expect(got).toEqual([
      'console|plain failure (app.js:7)',
      'react|The above error occurred in the <Foo> component:',
      'warning|deprecated',
      'pageerror|kaput (main.js:12)',
      `netfail|POST /api/save?${'q'.repeat(39)} net::ERR_FAILED`,
      'http|500 GET /api/x',
    ]);
  });
});

describe('formatErrors', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ seq: i + 1, kind: 'console' as const, text: `e${i}`, count: i === 0 ? 3 : 1 }));
  it('says none when empty or only warnings', () => {
    expect(formatErrors([])).toBe('none');
    expect(formatErrors([{ seq: 1, kind: 'warning', text: 'w', count: 1 }])).toBe('none');
  });
  it('lists lines with counts', () => {
    expect(formatErrors(mk(2))).toBe('[console] e0 ×3\n[console] e1');
  });
  it('truncates to max with a more line', () => {
    const out = formatErrors(mk(10), { max: 3 }).split('\n');
    expect(out).toEqual(['[console] e7', '[console] e8', '[console] e9', '… +7 more (errors --all)']);
  });
  it('includes warnings on request', () => {
    expect(formatErrors([{ seq: 1, kind: 'warning', text: 'w', count: 1 }], { warnings: true })).toBe('[warning] w');
  });
});
