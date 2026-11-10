import { describe, expect, it } from 'vitest';
import { HELP, helpFor, parseArgv } from '../src/commands.ts';
import type { Command } from '../src/types.ts';

const ok = (argv: string[]): Command => {
  const r = parseArgv(argv);
  if (!r.ok) throw new Error(r.error);
  return r.cmd;
};
const err = (argv: string[]): string => {
  const r = parseArgv(argv);
  if (r.ok) throw new Error('expected error, got ' + JSON.stringify(r.cmd));
  return r.error;
};

describe('parseArgv', () => {
  it('start', () => {
    expect(ok(['start'])).toEqual({ name: 'start' });
    expect(ok(['start', 'web', '--url', 'http://x', '--viewport=800x600', '--headed', '--keep'])).toEqual({
      name: 'start', app: 'web', url: 'http://x', viewport: { width: 800, height: 600 }, headed: true, keepProfile: true,
    });
    expect(err(['start', '--viewport', 'big'])).toMatch(/^usage: start/);
  });
  it('simple commands and no-arg errors', () => {
    for (const n of ['stop', 'status', 'diff', 'pages']) expect(ok([n])).toEqual({ name: n });
    expect(err(['stop', 'x'])).toBe('usage: stop');
    expect(ok([])).toEqual({ name: 'help' });
    expect(ok(['help', 'click'])).toEqual({ name: 'help', topic: 'click' });
  });
  it('snapshot and aliases', () => {
    expect(ok(['snap'])).toEqual({ name: 'snapshot' });
    expect(ok(['s', '@r5', '--depth', '3', '--max=40', '--visible', '--all'])).toEqual({
      name: 'snapshot', scope: 'r5', depth: 3, max: 40, visible: true, all: true,
    });
    expect(err(['snapshot', 'foo'])).toMatch(/^usage: snapshot/);
    expect(err(['snapshot', '--depth', 'x'])).toMatch(/^usage: snapshot/);
  });
  it('refs normalise', () => {
    for (const r of ['r12', '@r12', '[r12]', '[@r12]']) expect(ok(['hover', r])).toEqual({ name: 'hover', ref: 'r12' });
    expect(err(['hover', 'x12'])).toBe('usage: hover rN [--quiet] [--timeout ms]');
  });
  it('find', () => {
    expect(ok(['find', 'Save', 'as', '--role', 'button'])).toEqual({ name: 'find', text: 'Save as', role: 'button' });
    expect(err(['find'])).toMatch(/^usage: find/);
  });
  it('click family with action opts', () => {
    expect(ok(['click', 'r1'])).toEqual({ name: 'click', ref: 'r1' });
    expect(ok(['click', 'r1', '--right', '-q', '--timeout', '900'])).toEqual({ name: 'click', ref: 'r1', right: true, quiet: true, timeout: 900 });
    expect(ok(['dblclick', 'r2', '--quiet'])).toEqual({ name: 'dblclick', ref: 'r2', quiet: true });
    expect(err(['click', 'r1', '--timeout', 'abc'])).toMatch(/^usage: click rN/);
    expect(err(['click', 'r1', '--bogus'])).toMatch(/^usage: click/);
    expect(err(['click'])).toMatch(/^usage: click/);
  });
  it('type and fill', () => {
    expect(ok(['type', 'r3', 'hello', 'world', '--enter'])).toEqual({ name: 'type', ref: 'r3', text: 'hello world', enter: true });
    expect(ok(['fill', 'r3', '--enter'])).toEqual({ name: 'fill', ref: 'r3', text: '', enter: true });
    expect(ok(['fill', 'r3', ''])).toEqual({ name: 'fill', ref: 'r3', text: '' });
    expect(err(['type', 'r3'])).toMatch(/^usage: type/);
    expect(ok(['fill', 'r3', '--', '--odd'])).toEqual({ name: 'fill', ref: 'r3', text: '--odd' });
  });
  it('press', () => {
    expect(ok(['press', 'Enter'])).toEqual({ name: 'press', key: 'Enter' });
    expect(ok(['press', 'r4', 'Control+a'])).toEqual({ name: 'press', ref: 'r4', key: 'Control+a' });
    expect(err(['press'])).toMatch(/^usage: press/);
    expect(err(['press', 'a', 'b'])).toMatch(/^usage: press/);
  });
  it('select', () => {
    expect(ok(['select', 'r5', 'Option', 'Two'])).toEqual({ name: 'select', ref: 'r5', option: 'Option Two' });
    expect(err(['select', 'r5'])).toMatch(/^usage: select/);
  });
  it('check / uncheck / audit', () => {
    expect(ok(['check', 'r6'])).toEqual({ name: 'tick', ref: 'r6', on: true });
    expect(ok(['uncheck', '@r6', '-q'])).toEqual({ name: 'tick', ref: 'r6', on: false, quiet: true });
    expect(err(['uncheck'])).toMatch(/^usage: uncheck/);
    expect(ok(['check'])).toEqual({ name: 'audit', kinds: ['names', 'overflow', 'overlap', 'focus', 'i18n'] });
    expect(ok(['audit', 'narrow', 'tab', 'narrow'])).toEqual({ name: 'audit', kinds: ['narrow', 'tab'] });
    expect(ok(['check', 'all'])).toEqual({ name: 'audit', kinds: ['names', 'overflow', 'overlap', 'focus', 'i18n', 'narrow', 'tab'] });
    expect(err(['check', 'bogus'])).toMatch(/^usage: check/);
  });
  it('scroll', () => {
    expect(ok(['scroll'])).toEqual({ name: 'scroll' });
    expect(ok(['scroll', 'down'])).toEqual({ name: 'scroll', dir: 'down' });
    expect(ok(['scroll', 'r7', 'up', '300', '-q'])).toEqual({ name: 'scroll', ref: 'r7', dir: 'up', amount: 300, quiet: true });
    expect(ok(['scroll', '200'])).toEqual({ name: 'scroll', amount: 200 });
    expect(err(['scroll', 'sideways'])).toMatch(/^usage: scroll/);
  });
  it('goto / back / forward / reload', () => {
    expect(ok(['goto', 'http://a/b'])).toEqual({ name: 'goto', url: 'http://a/b' });
    expect(ok(['back', '--timeout', '10'])).toEqual({ name: 'back', timeout: 10 });
    expect(ok(['forward'])).toEqual({ name: 'forward' });
    expect(ok(['reload', '-q'])).toEqual({ name: 'reload', quiet: true });
    expect(err(['goto'])).toMatch(/^usage: goto/);
  });
  it('page / resize', () => {
    expect(ok(['page', '2'])).toEqual({ name: 'page', index: 2 });
    expect(err(['page', 'x'])).toBe('usage: page N');
    expect(ok(['closepage', '1'])).toEqual({ name: 'closepage', index: 1 });
    expect(err(['closepage'])).toMatch(/^usage: closepage N/);
    expect(ok(['eval', 'document.title', '+', '1'])).toEqual({ name: 'eval', code: 'document.title + 1' });
    expect(err(['eval'])).toMatch(/^usage: eval JS/);
    expect(ok(['resize', '390x844'])).toEqual({ name: 'resize', width: 390, height: 844 });
    expect(ok(['resize', '390', '844'])).toEqual({ name: 'resize', width: 390, height: 844 });
    expect(ok(['resize', '390x844', '-q'])).toEqual({ name: 'resize', width: 390, height: 844, quiet: true });
    expect(ok(['wait', '1500', '-q'])).toEqual({ name: 'wait', kind: 'ms', ms: 1500, quiet: true });
    expect(err(['resize', '390'])).toMatch(/^usage: resize/);
  });
  it('wait', () => {
    expect(ok(['wait', 'r9'])).toEqual({ name: 'wait', kind: 'ref', ref: 'r9' });
    expect(ok(['wait', 'gone', 'r9', '--timeout', '1000'])).toEqual({ name: 'wait', kind: 'gone', ref: 'r9', timeout: 1000 });
    expect(ok(['wait', 'gone', 'Loading', 'now'])).toEqual({ name: 'wait', kind: 'gone', text: 'Loading now' });
    expect(ok(['wait', 'idle'])).toEqual({ name: 'wait', kind: 'idle' });
    expect(ok(['wait', 'url', '/home'])).toEqual({ name: 'wait', kind: 'url', text: '/home' });
    expect(ok(['wait', '500'])).toEqual({ name: 'wait', kind: 'ms', ms: 500 });
    expect(ok(['wait', 'text', 'Saved'])).toEqual({ name: 'wait', kind: 'text', text: 'Saved' });
    expect(ok(['wait', 'Saved', 'ok'])).toEqual({ name: 'wait', kind: 'text', text: 'Saved ok' });
    expect(err(['wait'])).toMatch(/^usage: wait/);
  });
  it('errors / screenshot / log', () => {
    expect(ok(['errors', '--all', '--warn', '--clear'])).toEqual({ name: 'errors', all: true, warnings: true, clear: true });
    expect(ok(['errors'])).toEqual({ name: 'errors' });
    expect(ok(['shot', 'r2', '--full', '--path', '/t/a.png'])).toEqual({ name: 'screenshot', ref: 'r2', full: true, path: '/t/a.png' });
    expect(ok(['screenshot'])).toEqual({ name: 'screenshot' });
    expect(ok(['log', '--playwright', '--path=/x', '--tail', '20'])).toEqual({ name: 'log', playwright: true, path: '/x', tail: 20 });
    expect(err(['log', '--tail', 'x'])).toMatch(/^usage: log/);
  });
  it('unknown command', () => expect(err(['frobnicate'])).toBe("unknown command 'frobnicate'; try: help"));
});

describe('help', () => {
  it('is compact', () => expect(HELP.split('\n').length).toBeLessThanOrEqual(40));
  it('helpFor matches commands and aliases, else HELP', () => {
    expect(helpFor('click')).toMatch(/^click rN/);
    expect(helpFor('shot')).toMatch(/^screenshot/);
    expect(helpFor('nope')).toBe(HELP);
  });
});
