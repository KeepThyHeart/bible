/**
 * argv -> Command parsing and the help text. Pure and light: no playwright, no
 * session code, because the client imports this lazily for `help` and the daemon
 * uses it to reject bad input before it reaches the executor.
 */

import { DEFAULT_AUDIT_KINDS } from './types.ts';
import type { AuditKind, Command, ParseResult, WaitKind } from './types.ts';

const AUDIT_KINDS: AuditKind[] = ['names', 'overflow', 'overlap', 'focus', 'i18n', 'narrow', 'tab'];
const DIRS = ['up', 'down', 'left', 'right'] as const;
const ACT = '[--quiet] [--timeout ms]';

/** One line per command: the usage string. First word is the command name. */
const USAGE: Record<string, string> = {
  start: 'start [APP] [--url URL] [--viewport WxH] [--headed] [--keep]',
  stop: 'stop',
  status: 'status',
  help: 'help [CMD]',
  snapshot: 'snapshot [rN] [--depth N] [--max N] [--visible] [--all]   (snap, s)',
  diff: 'diff',
  find: 'find TEXT... [--role ROLE]',
  click: `click rN [--right] ${ACT}`,
  dblclick: `dblclick rN ${ACT}`,
  hover: `hover rN ${ACT}`,
  type: `type rN TEXT... [--enter] ${ACT}`,
  fill: `fill rN [TEXT...] [--enter] ${ACT}`,
  press: `press [rN] KEY ${ACT}`,
  select: `select rN OPTION... ${ACT}`,
  check: `check rN | check [names|overflow|overlap|focus|i18n|narrow|tab|all]...   (uncheck rN; audit)`,
  scroll: `scroll [rN] [up|down|left|right] [PIXELS] ${ACT}`,
  goto: `goto URL ${ACT}`,
  back: `back ${ACT}`,
  forward: `forward ${ACT}`,
  reload: `reload ${ACT}`,
  pages: 'pages',
  page: 'page N',
  resize: 'resize WxH | resize W H',
  wait: 'wait rN | gone rN|TEXT... | idle | url TEXT | MS | text TEXT... | TEXT...  [--timeout ms]',
  errors: 'errors [--all] [--warn] [--clear]',
  screenshot: 'screenshot [rN] [--full] [--path P]   (shot)',
  log: 'log [--playwright] [--path P] [--tail N]',
};

/** Extra names that map to a command's usage line, for `help CMD`. */
const ALIASES: Record<string, string> = { snap: 'snapshot', s: 'snapshot', shot: 'screenshot', audit: 'check', uncheck: 'check' };

export const HELP: string = [
  'drive [--session NAME] CMD ...   (refs: r12; every action takes --quiet|-q and --timeout ms)',
  ...Object.values(USAGE),
].join('\n');

export function helpFor(topic: string): string {
  const name = ALIASES[topic] ?? topic;
  return USAGE[name] ?? HELP;
}

// ---------------------------------------------------------------------------

type FlagKind = 'bool' | 'int' | 'str';
interface Parsed {
  pos: string[];
  f: Record<string, string | number | boolean>;
}

/** Thrown to produce a one-line error. */
class UsageError extends Error {}

const isRef = (s: string): boolean => /^\[?@?r\d+\]?$/.test(s);
const normRef = (s: string): string => s.replace(/[[@\]]/g, '');
const isInt = (s: string): boolean => /^\d+$/.test(s);

/** Splits flags (`--a=v`, `--a v`, `-q`, `--` ends flags) from positionals. */
function parseFlags(args: string[], spec: Record<string, FlagKind>, usage: string): Parsed {
  const pos: string[] = [];
  const f: Parsed['f'] = {};
  const bad = (): never => {
    throw new UsageError(`usage: ${usage}`);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (a === '-q' && 'quiet' in spec) {
      f.quiet = true;
      continue;
    }
    if (!a.startsWith('--') || a.length < 3) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    const kind = spec[name];
    if (!kind) return bad();
    if (kind === 'bool') {
      if (eq >= 0) bad();
      f[name] = true;
      continue;
    }
    const val = eq >= 0 ? a.slice(eq + 1) : args[++i];
    if (val === undefined || val === '') bad();
    if (kind === 'int') {
      if (!isInt(val)) bad();
      f[name] = Number(val);
    } else f[name] = val;
  }
  return { pos, f };
}

function parseSize(s: string): { width: number; height: number } | undefined {
  const m = /^(\d+)x(\d+)$/i.exec(s);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

const actSpec = (extra: Record<string, FlagKind> = {}): Record<string, FlagKind> => ({ quiet: 'bool', timeout: 'int', ...extra });

/** Only the keys that were given, so commands stay small and tests can compare exactly. */
function actOpts(f: Parsed['f']): { quiet?: boolean; timeout?: number } {
  const o: { quiet?: boolean; timeout?: number } = {};
  if (f.quiet) o.quiet = true;
  if (typeof f.timeout === 'number') o.timeout = f.timeout;
  return o;
}

export function parseArgv(argv: string[]): ParseResult {
  try {
    return { ok: true, cmd: build(argv) };
  } catch (e) {
    if (e instanceof UsageError) return { ok: false, error: e.message };
    throw e;
  }
}

function build(argv: string[]): Command {
  if (argv.length === 0) return { name: 'help' };
  const [head, ...rest] = argv;
  const name = ALIASES[head] && head !== 'uncheck' ? ALIASES[head] : head;
  const usage = USAGE[name] ?? USAGE[ALIASES[head] ?? ''];
  const u = (): string => (usage ?? '').replace(/ {3}\(.*\)$/, '');
  const fail = (): never => {
    throw new UsageError(`usage: ${u()}`);
  };
  const need = (ok: boolean): void => {
    if (!ok) fail();
  };
  const ref = (s: string | undefined): string => {
    if (s === undefined || !isRef(s)) return fail();
    return normRef(s);
  };

  switch (name) {
    case 'start': {
      const { pos, f } = parseFlags(rest, { url: 'str', viewport: 'str', headed: 'bool', keep: 'bool' }, u());
      need(pos.length <= 1);
      const c: Extract<Command, { name: 'start' }> = { name: 'start' };
      if (pos[0] !== undefined) c.app = pos[0];
      if (f.url) c.url = String(f.url);
      if (f.viewport) {
        const vp = parseSize(String(f.viewport));
        if (!vp) fail();
        c.viewport = vp;
      }
      if (f.headed) c.headed = true;
      if (f.keep) c.keepProfile = true;
      return c;
    }
    case 'stop':
    case 'status':
    case 'diff':
    case 'pages': {
      need(rest.length === 0);
      return { name } as Command;
    }
    case 'help': {
      need(rest.length <= 1);
      return rest.length ? { name: 'help', topic: rest[0] } : { name: 'help' };
    }
    case 'snapshot': {
      const { pos, f } = parseFlags(rest, { depth: 'int', max: 'int', visible: 'bool', all: 'bool' }, u());
      need(pos.length <= 1);
      const c: Extract<Command, { name: 'snapshot' }> = { name: 'snapshot' };
      if (pos.length) c.scope = ref(pos[0]);
      if (typeof f.depth === 'number') c.depth = f.depth;
      if (typeof f.max === 'number') c.max = f.max;
      if (f.visible) c.visible = true;
      if (f.all) c.all = true;
      return c;
    }
    case 'find': {
      const { pos, f } = parseFlags(rest, { role: 'str' }, u());
      need(pos.length > 0);
      const c: Extract<Command, { name: 'find' }> = { name: 'find', text: pos.join(' ') };
      if (f.role) c.role = String(f.role);
      return c;
    }
    case 'click': {
      const { pos, f } = parseFlags(rest, actSpec({ right: 'bool' }), u());
      need(pos.length === 1);
      return { name: 'click', ref: ref(pos[0]), ...(f.right ? { right: true } : {}), ...actOpts(f) };
    }
    case 'dblclick':
    case 'hover': {
      const { pos, f } = parseFlags(rest, actSpec(), u());
      need(pos.length === 1);
      return { name, ref: ref(pos[0]), ...actOpts(f) };
    }
    case 'type':
    case 'fill': {
      const { pos, f } = parseFlags(rest, actSpec({ enter: 'bool' }), u());
      need(pos.length >= 1);
      const text = pos.slice(1).join(' ');
      if (name === 'type') need(pos.length >= 2);
      return { name, ref: ref(pos[0]), text, ...(f.enter ? { enter: true } : {}), ...actOpts(f) };
    }
    case 'press': {
      const { pos, f } = parseFlags(rest, actSpec(), u());
      need(pos.length === 1 || (pos.length === 2 && isRef(pos[0])));
      if (pos.length === 2) return { name: 'press', ref: ref(pos[0]), key: pos[1], ...actOpts(f) };
      return { name: 'press', key: pos[0], ...actOpts(f) };
    }
    case 'select': {
      const { pos, f } = parseFlags(rest, actSpec(), u());
      need(pos.length >= 2);
      return { name: 'select', ref: ref(pos[0]), option: pos.slice(1).join(' '), ...actOpts(f) };
    }
    case 'uncheck': {
      const { pos, f } = parseFlags(rest, actSpec(), 'uncheck rN [--quiet] [--timeout ms]');
      if (pos.length !== 1 || !isRef(pos[0])) throw new UsageError('usage: uncheck rN [--quiet] [--timeout ms]');
      return { name: 'tick', ref: normRef(pos[0]), on: false, ...actOpts(f) };
    }
    case 'check': {
      const { pos, f } = parseFlags(rest, actSpec(), u());
      if (pos.length === 1 && isRef(pos[0])) return { name: 'tick', ref: normRef(pos[0]), on: true, ...actOpts(f) };
      if (Object.keys(f).length) fail();
      if (pos.length === 0) return { name: 'audit', kinds: [...DEFAULT_AUDIT_KINDS] };
      const kinds = new Set<AuditKind>();
      for (const k of pos) {
        if (k === 'all') AUDIT_KINDS.forEach((x) => kinds.add(x));
        else if ((AUDIT_KINDS as string[]).includes(k)) kinds.add(k as AuditKind);
        else fail();
      }
      return { name: 'audit', kinds: [...kinds] };
    }
    case 'scroll': {
      const { pos, f } = parseFlags(rest, actSpec(), u());
      const c: Extract<Command, { name: 'scroll' }> = { name: 'scroll', ...actOpts(f) };
      const q = [...pos];
      if (q.length && isRef(q[0])) c.ref = normRef(q.shift() as string);
      if (q.length && (DIRS as readonly string[]).includes(q[0])) c.dir = q.shift() as (typeof DIRS)[number];
      if (q.length && isInt(q[0])) c.amount = Number(q.shift());
      need(q.length === 0);
      return c;
    }
    case 'goto': {
      const { pos, f } = parseFlags(rest, actSpec(), u());
      need(pos.length === 1);
      return { name: 'goto', url: pos[0], ...actOpts(f) };
    }
    case 'back':
    case 'forward':
    case 'reload': {
      const { pos, f } = parseFlags(rest, actSpec(), u());
      need(pos.length === 0);
      return { name, ...actOpts(f) };
    }
    case 'page': {
      need(rest.length === 1 && isInt(rest[0]));
      return { name: 'page', index: Number(rest[0]) };
    }
    case 'resize': {
      if (rest.length === 1) {
        const s = parseSize(rest[0]);
        if (s) return { name: 'resize', ...s };
      } else if (rest.length === 2 && isInt(rest[0]) && isInt(rest[1])) {
        return { name: 'resize', width: Number(rest[0]), height: Number(rest[1]) };
      }
      return fail();
    }
    case 'wait':
      return buildWait(rest, u());
    case 'errors': {
      const { pos, f } = parseFlags(rest, { all: 'bool', warn: 'bool', clear: 'bool' }, u());
      need(pos.length === 0);
      return {
        name: 'errors',
        ...(f.all ? { all: true } : {}),
        ...(f.warn ? { warnings: true } : {}),
        ...(f.clear ? { clear: true } : {}),
      };
    }
    case 'screenshot': {
      const { pos, f } = parseFlags(rest, { full: 'bool', path: 'str' }, u());
      need(pos.length <= 1);
      const c: Extract<Command, { name: 'screenshot' }> = { name: 'screenshot' };
      if (pos.length) c.ref = ref(pos[0]);
      if (f.full) c.full = true;
      if (f.path) c.path = String(f.path);
      return c;
    }
    case 'log': {
      const { pos, f } = parseFlags(rest, { playwright: 'bool', path: 'str', tail: 'int' }, u());
      need(pos.length === 0);
      return {
        name: 'log',
        ...(f.playwright ? { playwright: true } : {}),
        ...(f.path ? { path: String(f.path) } : {}),
        ...(typeof f.tail === 'number' ? { tail: f.tail } : {}),
      };
    }
    default:
      throw new UsageError(`unknown command '${head}'; try: help`);
  }
}

function buildWait(rest: string[], usage: string): Command {
  const { pos, f } = parseFlags(rest, { timeout: 'int' }, usage);
  const timeout = typeof f.timeout === 'number' ? { timeout: f.timeout } : {};
  const mk = (kind: WaitKind, extra: { text?: string; ref?: string; ms?: number } = {}): Command => ({
    name: 'wait',
    kind,
    ...extra,
    ...timeout,
  });
  if (pos.length === 0) throw new UsageError(`usage: ${usage}`);
  const [first, ...more] = pos;
  if (pos.length === 1 && isRef(first)) return mk('ref', { ref: normRef(first) });
  if (pos.length === 1 && isInt(first)) return mk('ms', { ms: Number(first) });
  if (first === 'idle' && more.length === 0) return mk('idle');
  if (first === 'gone' && more.length) {
    if (more.length === 1 && isRef(more[0])) return mk('gone', { ref: normRef(more[0]) });
    return mk('gone', { text: more.join(' ') });
  }
  if (first === 'url' && more.length) return mk('url', { text: more.join(' ') });
  if (first === 'text' && more.length) return mk('text', { text: more.join(' ') });
  return mk('text', { text: pos.join(' ') });
}
