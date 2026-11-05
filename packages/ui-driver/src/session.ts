/**
 * One driver session: the launched app, its pages, the ref'd snapshot baseline,
 * errors and the transcript. Implements every command; the daemon only queues.
 *
 * Every action replies with the diff it caused (capped), so an agent rarely needs
 * a full snapshot after the first one. That is where most of the token savings come from.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElementHandle, Page } from 'playwright-core';
import { diffSnapshots } from './diff.ts';
import { ErrorCollector, formatErrors } from './errors.ts';
import { launchApp } from './launch.ts';
import { findNodes, headerLine, refLines, renderSnapshot } from './render.ts';
import { toPlaywright, Transcript } from './transcript.ts';
import type {
  AuditItem, AuditKind, Command, Executor, LaunchedApp, LocatorHint, PageSnapshot, Reply,
} from './types.ts';

const RUNTIME = readFileSync(new URL('./page/runtime.js', import.meta.url), 'utf8');
const DEFAULT_TIMEOUT = 5000;
const AUTO_DIFF_MAX = 12;

type Act = Extract<Command, { ref: string }> | Extract<Command, { name: 'press' | 'scroll' | 'goto' | 'back' | 'forward' | 'reload' | 'wait' }>;

declare global {
  interface Window {
    __uid: {
      snap(o: object): PageSnapshot & { error?: string };
      resolve(ref: string): Element | null;
      hint(ref: string): LocatorHint | null;
      settle(quiet: number, max: number): Promise<{ mutations: number; ms: number }>;
      audit(kinds: string[]): AuditItem[];
      focusRef(): string;
      describe(ref: string): string | null;
      describeAt(x: number, y: number): string;
      refOf(el: Element): string | null;
    };
  }
}

class Fail extends Error {}

const ok = (text: string): Reply => ({ ok: true, text });
const bad = (text: string): Reply => ({ ok: false, text });

export class Session implements Executor {
  private readonly sessionDir: string;
  private readonly repoRoot: string;
  private app?: LaunchedApp;
  private pages: Page[] = [];
  private cur = 0;
  private errors = new ErrorCollector();
  private transcript?: Transcript;
  private base?: PageSnapshot;
  private lines = new Map<string, string>();
  private nextRef = 1;
  private sigs: Record<string, string> = {};
  private errMarkCmd = 0;
  private errMarkAct = 0;
  private inflight = 0;
  private notes: string[] = [];
  private shots = 0;

  private readonly label: string | undefined;

  constructor(opts: { sessionDir: string; repoRoot: string; name?: string }) {
    this.sessionDir = opts.sessionDir;
    this.repoRoot = opts.repoRoot;
    this.label = opts.name || undefined;
  }

  // ------------------------------------------------------------------ entry

  async exec(cmd: Command): Promise<Reply> {
    let reply: Reply;
    let hint: LocatorHint | undefined;
    const before = this.page()?.url();
    try {
      if ('ref' in cmd && cmd.ref && this.app && cmd.name !== 'screenshot') hint = await this.hint(cmd.ref).catch(() => undefined);
      reply = await this.run(cmd);
    } catch (e) {
      reply = bad(e instanceof Fail ? e.message : 'error: ' + String((e as Error)?.message ?? e).split('\n')[0]);
    }
    if (this.transcript && cmd.name !== 'log' && cmd.name !== 'help') {
      const after = this.page()?.url();
      this.transcript.add({
        argv: argvOf(cmd),
        ok: reply.ok,
        summary: reply.text.split('\n')[0].slice(0, 120),
        ...(hint ? { hint } : {}),
        ...(after && after !== before ? { url: after } : {}),
      });
    }
    return reply;
  }

  async shutdown(): Promise<void> {
    const app = this.app;
    this.app = undefined;
    this.pages = [];
    this.base = undefined;
    if (app) await app.close().catch(() => undefined);
  }

  /** The session's name: --session / DRIVE_SESSION when given (also with DRIVE_DIR), else the directory's name. */
  private name(): string {
    return this.label ?? path.basename(this.sessionDir);
  }

  private page(): Page | undefined {
    return this.pages[this.cur];
  }

  private need(): Page {
    const p = this.page();
    if (!this.app || !p) throw new Fail('not started: drive start web|desktop');
    if (p.isClosed()) throw new Fail(`page ${this.cur} is closed; pages`);
    return p;
  }

  private async run(cmd: Command): Promise<Reply> {
    switch (cmd.name) {
      case 'help': return ok('help is answered by the daemon');
      case 'start': return this.start(cmd);
      case 'stop': {
        const n = this.transcript?.entries().length ?? 0;
        await this.shutdown();
        return ok(`stopped session ${this.name()} (${n} commands; transcript ${path.join(this.sessionDir, 'transcript.jsonl')})`);
      }
      case 'status': return ok(this.status());
      case 'snapshot': return this.snapshotCmd(cmd);
      case 'diff': {
        const p = this.need();
        const s = await this.snap(p);
        const d = diffSnapshots(this.base, s, { max: 40 });
        this.setBase(s);
        return ok(d.join('\n'));
      }
      case 'find': {
        const s = await this.snap(this.need());
        return ok(findNodes(s.root, cmd.text, cmd.role));
      }
      case 'resize': {
        const p = this.need();
        await p.setViewportSize({ width: cmd.width, height: cmd.height });
        await this.settle(p);
        return this.afterAction(p, !!cmd.quiet);
      }
      case 'errors': {
        const entries = cmd.all ? this.errors.all({ warnings: cmd.warnings }) : this.errors.since(this.errMarkCmd, { warnings: cmd.warnings });
        this.errMarkCmd = this.errors.lastSeq();
        this.errMarkAct = Math.max(this.errMarkAct, this.errMarkCmd);
        const text = formatErrors(entries, { max: cmd.all ? 30 : 8, warnings: cmd.warnings });
        if (cmd.clear) this.errors.clear();
        return ok(entries.length ? text : 'none' + (cmd.all ? '' : ' new'));
      }
      case 'audit': return this.audit(cmd.kinds);
      case 'screenshot': return this.screenshot(cmd);
      case 'log': {
        const t = this.transcript;
        if (!t) return bad('no session yet');
        if (cmd.playwright) {
          if (!this.app) return bad('log --playwright needs the app running (it reads the launch target)');
          const file = path.resolve(cmd.path ?? path.join(this.sessionDir, 'repro.spec.ts'));
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, toPlaywright(t.entries(), this.app.repro));
          return ok(`wrote ${file} (${t.entries().length} steps; review locators before committing)`);
        }
        return ok(t.renderLog(cmd.tail ?? 30) || '(empty)');
      }
      case 'pages': {
        this.need();
        const rows = await Promise.all(this.pages.map(async (p, i) => {
          if (p.isClosed()) return `${i} (closed)`;
          return `${i}${i === this.cur ? '*' : ''} ${JSON.stringify(await p.title().catch(() => ''))} ${shortUrl(p.url())}`;
        }));
        return ok(rows.join('\n'));
      }
      case 'page': {
        this.need();
        if (!this.pages[cmd.index] || this.pages[cmd.index].isClosed()) return bad(`no page ${cmd.index}; pages`);
        this.cur = cmd.index;
        const p = this.pages[cmd.index];
        await p.bringToFront().catch(() => undefined);
        const s = await this.snap(p);
        this.setBase(s);
        return ok(`page ${cmd.index}: ${headerLine(s)}`);
      }
      default: return this.action(cmd as Act);
    }
  }

  // ------------------------------------------------------------------ start

  private async start(cmd: Extract<Command, { name: 'start' }>): Promise<Reply> {
    if (this.app) return bad(`already running ${this.app.info}; stop first`);
    mkdirSync(this.sessionDir, { recursive: true });
    this.transcript = new Transcript(path.join(this.sessionDir, 'transcript.jsonl'));
    writeFileSync(path.join(this.sessionDir, 'transcript.jsonl'), '');
    this.errors = new ErrorCollector();
    this.errMarkAct = this.errMarkCmd = 0;
    this.sigs = {};
    this.nextRef = 1;
    this.lines = new Map();
    this.base = undefined;
    const t0 = Date.now();
    const app = await launchApp({
      app: cmd.app ?? (cmd.url ? 'web' : undefined),
      url: cmd.url,
      viewport: cmd.viewport,
      headed: cmd.headed,
      keepProfile: cmd.keepProfile,
      repoRoot: this.repoRoot,
      sessionDir: this.sessionDir,
      log: (line) => console.error(`[launch] ${line}`),
      onBlocked: (method, url) => this.errors.add('blocked', `${method} ${shortUrl(url)} (read-only)`),
    });
    this.app = app;
    await app.context.addInitScript({ content: RUNTIME }).catch(() => undefined);
    const track = (p: Page) => {
      if (this.pages.includes(p)) return;
      this.pages.push(p);
      this.errors.attach(p);
      p.on('dialog', (d) => {
        this.notes.push(`! ${d.type()} dialog ${JSON.stringify(d.message().slice(0, 80))} dismissed`);
        d.dismiss().catch(() => undefined);
      });
      if (this.pages.length > 1) this.notes.push(`+ new page ${this.pages.length - 1} (pages; page N)`);
      p.on('close', () => { if (this.pages[this.cur] === p) this.notes.push(`! page ${this.cur} closed`); });
    };
    this.pages = [];
    this.cur = 0;
    track(app.page);
    this.notes = [];
    if (app.electron) {
      for (const w of app.electron.windows()) track(w);
      app.electron.on('window', track);
    } else {
      app.context.on('page', track);
    }
    app.context.on('request', () => { this.inflight++; });
    const done = () => { this.inflight = Math.max(0, this.inflight - 1); };
    app.context.on('requestfinished', done);
    app.context.on('requestfailed', done);
    const p = app.page;
    await this.settle(p, 2000);
    const s = await this.snap(p);
    this.setBase(s);
    const modal = await p.evaluate(() => {
      const m = document.querySelector('dialog[open], [aria-modal="true"]');
      return m ? window.__uid.describe(window.__uid.refOf(m) ?? '') : null;
    }).catch(() => null);
    return ok(`started ${app.info} in ${((Date.now() - t0) / 1000).toFixed(1)}s (session ${this.name()})\n${headerLine(s)}` +
      (modal ? `\n! modal open: ${modal}` : ''));
  }

  private status(): string {
    if (!this.app) return `session ${this.name()} idle: drive start web|desktop`;
    const p = this.page();
    const n = this.transcript?.entries().length ?? 0;
    const errs = this.errors.since(this.errMarkCmd).length;
    return `session ${this.name()} running ${this.app.info}; page ${this.cur}/${this.pages.length} ${p ? shortUrl(p.url()) : '-'}; ${n} commands; ${errs} new errors`;
  }

  // ------------------------------------------------------------------ snapshots

  private async ensureRuntime(p: Page): Promise<void> {
    const has = await p.evaluate(() => typeof window.__uid === 'object').catch(() => false);
    if (!has) await p.evaluate(RUNTIME);
  }

  /** A fresh full walk (refs assigned), retried once across a navigation. */
  private async snap(p: Page, opts: { scope?: string; visible?: boolean } = {}): Promise<PageSnapshot> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.ensureRuntime(p);
        const s = await p.evaluate((o) => window.__uid.snap(o), { nextRef: this.nextRef, seed: this.sigs, ...opts });
        if (s.error) throw new Fail(`stale ref ${opts.scope}${this.was(opts.scope)}; run snapshot`);
        this.nextRef = Math.max(this.nextRef, s.nextRef);
        if (!opts.scope && !opts.visible) this.sigs = s.sigs;
        return s;
      } catch (e) {
        if (e instanceof Fail || attempt >= 2) throw e;
        await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
      }
    }
  }

  private setBase(s: PageSnapshot): void {
    this.base = s;
    this.lines = refLines(s.root, this.lines);
  }

  private was(ref?: string): string {
    const l = ref ? this.lines.get(ref) : undefined;
    return l ? ` (was ${l})` : '';
  }

  private async snapshotCmd(cmd: Extract<Command, { name: 'snapshot' }>): Promise<Reply> {
    const p = this.need();
    const s = await this.snap(p, { scope: cmd.scope, visible: cmd.visible });
    if (!cmd.scope && !cmd.visible) this.setBase(s);
    else this.lines = refLines(s.root, this.lines);
    return ok(renderSnapshot(s, { depth: cmd.depth, max: cmd.max, all: cmd.all }));
  }

  // ------------------------------------------------------------------ actions

  private async handle(p: Page, ref: string): Promise<ElementHandle<Element>> {
    await this.ensureRuntime(p);
    const h = await p.evaluateHandle((r) => window.__uid.resolve(r), ref);
    const el = h.asElement();
    if (!el) {
      await h.dispose();
      if (!this.lines.has(ref) && Number(ref.slice(1)) >= this.nextRef) throw new Fail(`unknown ref ${ref} (refs so far: r1..r${this.nextRef - 1}); run snapshot or find`);
      throw new Fail(`stale ref ${ref}${this.was(ref)}: element gone; run snapshot`);
    }
    return el as ElementHandle<Element>;
  }

  private async hint(ref: string): Promise<LocatorHint | undefined> {
    const p = this.page();
    if (!p) return undefined;
    await this.ensureRuntime(p);
    return (await p.evaluate((r) => window.__uid.hint(r), ref)) ?? undefined;
  }

  private async settle(p: Page, max = 2500): Promise<void> {
    const t0 = Date.now();
    await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
    for (let i = 0; i < 2; i++) {
      try {
        await this.ensureRuntime(p);
        await p.evaluate(([q, m]) => window.__uid.settle(q, m), [150, max] as const);
        break;
      } catch {
        await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
      }
    }
    // in-flight requests (fetches that will re-render), bounded
    while (this.inflight > 0 && Date.now() - t0 < max + 1500) await new Promise(r => setTimeout(r, 50));
    if (this.inflight === 0) await p.evaluate(() => window.__uid.settle(100, 800)).catch(() => undefined);
  }

  private async action(cmd: Act): Promise<Reply> {
    const p = this.need();
    const timeout = ('timeout' in cmd && cmd.timeout) || DEFAULT_TIMEOUT;
    const focusBefore = await p.evaluate(() => window.__uid?.focusRef?.() ?? 'body').catch(() => 'body');
    try {
      await this.perform(p, cmd, timeout);
    } catch (e) {
      if (e instanceof Fail) throw e;
      return bad(await this.explain(p, cmd, e as Error));
    }
    const p2 = this.page() ?? p;
    if (!p2.isClosed()) await this.settle(p2);
    const r = await this.afterAction(p2, !!('quiet' in cmd && cmd.quiet), focusBefore);
    return r;
  }

  private async perform(p: Page, cmd: Act, timeout: number): Promise<void> {
    switch (cmd.name) {
      case 'click': {
        const el = await this.handle(p, cmd.ref);
        await el.click({ timeout, button: cmd.right ? 'right' : 'left' });
        return;
      }
      case 'dblclick': return (await this.handle(p, cmd.ref)).dblclick({ timeout });
      case 'hover': return (await this.handle(p, cmd.ref)).hover({ timeout });
      case 'fill': {
        const el = await this.handle(p, cmd.ref);
        await el.fill(cmd.text, { timeout });
        if (cmd.enter) await el.press('Enter', { timeout });
        return;
      }
      case 'type': {
        const el = await this.handle(p, cmd.ref);
        await el.focus();
        await el.type(cmd.text, { timeout, delay: 10 });
        if (cmd.enter) await el.press('Enter', { timeout });
        return;
      }
      case 'press': {
        if (cmd.ref) return (await this.handle(p, cmd.ref)).press(cmd.key, { timeout });
        return p.keyboard.press(cmd.key);
      }
      case 'select': {
        const el = await this.handle(p, cmd.ref);
        const tag = await el.evaluate((e) => e.tagName);
        if (tag !== 'SELECT') throw new Fail(`select: ${cmd.ref} is not a <select>; click it and pick an option`);
        let done = await el.selectOption({ label: cmd.option }, { timeout }).catch(() => [] as string[]);
        if (!done.length) done = await el.selectOption(cmd.option, { timeout }).catch(() => [] as string[]);
        if (!done.length) {
          const opts = await el.evaluate((e) => Array.from((e as HTMLSelectElement).options).map(o => o.label).slice(0, 12));
          throw new Fail(`select: no option ${JSON.stringify(cmd.option)}; options: ${opts.map(o => JSON.stringify(o)).join(', ')}`);
        }
        return;
      }
      case 'tick': {
        const el = await this.handle(p, cmd.ref);
        if (cmd.on) await el.check({ timeout });
        else await el.uncheck({ timeout });
        return;
      }
      case 'scroll': {
        const amount = cmd.amount ?? 600;
        const d = cmd.dir ?? (cmd.ref ? undefined : 'down');
        const dx = d === 'left' ? -amount : d === 'right' ? amount : 0;
        const dy = d === 'up' ? -amount : d === 'down' ? amount : 0;
        if (cmd.ref) {
          const el = await this.handle(p, cmd.ref);
          if (!d) return el.scrollIntoViewIfNeeded({ timeout });
          await el.evaluate((e, [x, y]) => e.scrollBy(x, y), [dx, dy] as const);
          return;
        }
        const vp = p.viewportSize() ?? await p.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        await p.mouse.move(vp.width / 2, vp.height / 2);
        await p.mouse.wheel(dx, dy);
        return;
      }
      case 'goto': {
        const url = this.resolveUrl(p, cmd.url);
        await p.goto(url, { timeout: Math.max(timeout, 30000), waitUntil: 'domcontentloaded' });
        return;
      }
      case 'back': await p.goBack({ timeout: Math.max(timeout, 15000), waitUntil: 'domcontentloaded' }); return;
      case 'forward': await p.goForward({ timeout: Math.max(timeout, 15000), waitUntil: 'domcontentloaded' }); return;
      case 'reload': await p.reload({ timeout: Math.max(timeout, 30000), waitUntil: 'domcontentloaded' }); return;
      case 'wait': return this.waitFor(p, cmd);
    }
  }

  private resolveUrl(p: Page, url: string): string {
    const app = this.app as LaunchedApp;
    const base = app.baseUrl ?? p.url();
    const abs = new URL(url, url.startsWith('/') && app.baseUrl ? app.baseUrl : p.url() || base).href;
    if (app.readOnly && app.baseUrl && new URL(abs).origin !== new URL(app.baseUrl).origin) {
      throw new Fail(`goto: read-only session stays on ${new URL(app.baseUrl).origin}`);
    }
    return abs;
  }

  private async waitFor(p: Page, cmd: Extract<Command, { name: 'wait' }>): Promise<void> {
    const timeout = cmd.timeout ?? 10000;
    const deadline = Date.now() + timeout;
    const poll = async (fn: () => Promise<boolean>, what: string) => {
      for (;;) {
        if (await fn().catch(() => false)) return;
        if (Date.now() > deadline) throw new Fail(`wait: timed out after ${timeout}ms waiting for ${what}`);
        await new Promise(r => setTimeout(r, 100));
      }
    };
    switch (cmd.kind) {
      case 'ms': await new Promise(r => setTimeout(r, cmd.ms ?? 0)); return;
      case 'idle': await this.settle(p, timeout); return;
      case 'url': return poll(async () => p.url().includes(cmd.text ?? ''), `url ~ ${cmd.text}`);
      case 'text': {
        try {
          await p.getByText(cmd.text ?? '').first().waitFor({ state: 'visible', timeout });
        } catch {
          throw new Fail(`wait: timed out after ${timeout}ms waiting for text ${JSON.stringify(cmd.text)}`);
        }
        return;
      }
      case 'ref': return poll(async () => {
        await this.ensureRuntime(p);
        return p.evaluate((r) => { const e = window.__uid.resolve(r); return !!e && e.checkVisibility(); }, cmd.ref as string);
      }, cmd.ref as string);
      case 'gone': {
        if (cmd.ref) {
          return poll(async () => {
            await this.ensureRuntime(p);
            return p.evaluate((r) => { const e = window.__uid.resolve(r); return !e || !e.checkVisibility(); }, cmd.ref as string);
          }, `${cmd.ref} to go`);
        }
        try {
          await p.getByText(cmd.text ?? '').first().waitFor({ state: 'hidden', timeout });
        } catch {
          throw new Fail(`wait: ${JSON.stringify(cmd.text)} still visible after ${timeout}ms`);
        }
      }
    }
  }

  /** The reply after an action: the diff since the baseline, notes, new errors. */
  private async afterAction(p: Page, quiet: boolean, focusBefore?: string): Promise<Reply> {
    const out: string[] = [];
    let s: PageSnapshot | undefined;
    if (!p.isClosed()) {
      s = await this.snap(p);
      if (!quiet) out.push(...diffSnapshots(this.base, s, { max: AUTO_DIFF_MAX }));
      if (focusBefore && /^r\d+$/.test(focusBefore) && s.focus === 'body') {
        const still = await p.evaluate((r) => !!window.__uid.resolve(r), focusBefore).catch(() => true);
        if (!still) out.push(`! focus lost: ${focusBefore} was removed, focus is on body`);
      }
      this.setBase(s);
    }
    out.push(...this.notes.splice(0));
    const fresh = this.errors.since(this.errMarkAct);
    this.errMarkAct = this.errors.lastSeq();
    if (fresh.length) {
      const first = formatErrors(fresh.slice(-1), { max: 1 });
      out.push(`! ${fresh.length} new error${fresh.length > 1 ? 's' : ''}: ${first}${fresh.length > 1 ? ' (errors)' : ''}`);
    }
    if (quiet || !out.length) out.unshift('ok');
    return ok(out.join('\n'));
  }

  /** A Playwright failure in one or two lines, naming what was in the way. */
  private async explain(p: Page, cmd: Act, e: Error): Promise<string> {
    const msg = String(e.message ?? e);
    const first = msg.split('\n')[0].replace(/^(elementHandle|locator|page)\.\w+: /, '').replace(/Timeout (\d+)ms exceeded\.?/, 'timed out ($1ms)');
    const intercept = /<([^\n>]+)>[^\n]*intercepts pointer events/.exec(msg);
    let why = '';
    if (intercept) {
      why = `covered by <${intercept[1].slice(0, 80)}>`;
      if ('ref' in cmd && cmd.ref) {
        const at = await p.evaluate((r) => {
          const el = window.__uid.resolve(r);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return window.__uid.describeAt(b.left + b.width / 2, b.top + b.height / 2);
        }, cmd.ref).catch(() => null);
        if (at) why = `covered by ${at}`;
      }
    } else if (/not visible/.test(msg)) why = 'element is not visible';
    else if (/not enabled|disabled/.test(msg)) why = 'element is disabled';
    else if (/not editable/.test(msg)) why = 'element is not editable';
    else if (/detached|not attached/.test(msg)) why = 'element was removed; run snapshot';
    const label = cmd.name + ('ref' in cmd && cmd.ref ? ' ' + cmd.ref : '');
    return `${label} failed: ${why || first}`;
  }

  // ------------------------------------------------------------------ audit

  private async audit(kinds: AuditKind[]): Promise<Reply> {
    const p = this.need();
    await this.snap(p); // assign refs to everything on screen
    const items: AuditItem[] = [];
    const pageKinds = kinds.filter(k => k !== 'narrow' && k !== 'tab');
    if (pageKinds.length) items.push(...await p.evaluate((k) => window.__uid.audit(k), pageKinds));
    // narrow and tab change layout and focus: a dialog or popup they close (an app that re-mounts at
    // 360px, a popup that closes when focus leaves it) is reported, since later refs into it are stale.
    const openDialogs = () => p.evaluate(() => Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog],dialog[open],[role=menu]'))
      .filter((d) => (d as HTMLElement).checkVisibility?.() ?? true)
      .map((d) => `${d.getAttribute('role') ?? 'dialog'} "${(d.getAttribute('aria-label') ?? '').slice(0, 30)}"`)).catch(() => [] as string[]);
    for (const k of ['narrow', 'tab'] as const) {
      if (!kinds.includes(k)) continue;
      const before = await openDialogs();
      items.push(...await (k === 'narrow' ? this.narrow(p) : this.tabWalk(p)));
      const after = new Set(await openDialogs());
      const gone = before.filter((d) => !after.has(d));
      if (gone.length) items.push({ kind: 'info-closed', detail: `the ${k} check closed ${gone.join(', ')} (reopen it before using its refs)` });
    }
    const by = new Map<string, AuditItem[]>();
    for (const it of items) {
      const list = by.get(it.kind) ?? [];
      list.push(it);
      by.set(it.kind, list);
    }
    const issues = items.filter(it => !it.kind.startsWith('info-')).length;
    const lines = [issues ? `check: ${issues} issue${issues > 1 ? 's' : ''}` : `check: clean (${kinds.join(' ')})`];
    for (const [kind, list] of by) {
      if (kind.startsWith('info-')) { lines.push(`${kind.slice(5)}: ${list.map(it => it.detail).join('; ')}`); continue; }
      const shown = list.slice(0, 5).map(it => {
        const who = it.ref ? `[${it.ref}]${this.lines.get(it.ref) ? ' ' + this.lines.get(it.ref)!.replace(/^\[r\d+\] /, '').slice(0, 40) : ''}` : it.el ?? '';
        return who ? `${who} ${it.detail}` : it.detail;
      });
      lines.push(`${kind} ${list.length}: ${shown.join('; ')}${list.length > 5 ? `; +${list.length - 5} more` : ''}`);
    }
    return ok(lines.join('\n'));
  }

  private async narrow(p: Page): Promise<AuditItem[]> {
    // Electron windows have no emulated viewport (viewportSize() is null): measure it
    const old = p.viewportSize() ?? await p.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const height = old.height;
    await p.setViewportSize({ width: 360, height });
    await this.settle(p, 1500);
    try {
      await this.snap(p);
      const found = await p.evaluate(() => window.__uid.audit(['overflow', 'overlap']));
      return [...found.map(it => ({ ...it, kind: 'narrow-' + it.kind })), { kind: 'info-narrow', detail: `checked at 360x${height}, restored ${old.width}x${old.height}` }];
    } finally {
      await p.setViewportSize(old);
      await this.settle(p, 1500);
      const s = await this.snap(p);
      this.setBase(s);
    }
  }

  /**
   * Presses Tab until focus wraps (up to 80 presses) and reports the order as info,
   * plus invisible stops and short cycles outside a modal (traps). Focus is put back.
   */
  private async tabWalk(p: Page): Promise<AuditItem[]> {
    const before = await p.evaluate(() => window.__uid.focusRef());
    await p.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); });
    const stops: string[] = [];
    const items: AuditItem[] = [];
    let wrapped = false;
    for (let i = 0; i < 80; i++) {
      await p.keyboard.press('Tab');
      const f = await p.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body) return { ref: 'body', vis: true };
        const b = a.getBoundingClientRect();
        let ref = window.__uid.refOf(a) ?? null;
        if (!ref) { window.__uid.snap({}); ref = window.__uid.refOf(a); }
        return { ref: ref ?? window.__uid.describeAt(b.left + 1, b.top + 1), vis: a.checkVisibility() && b.width > 0 && b.height > 0 };
      });
      if (stops.length && (f.ref === stops[0] || (f.ref === 'body' && stops.some(x => x !== 'body')))) { wrapped = true; break; }
      if (!f.vis) items.push({ kind: 'tab-hidden', detail: `stop ${i + 1} is invisible: ${f.ref}` });
      stops.push(f.ref);
    }
    const distinct = new Set(stops);
    if (!wrapped) {
      let period = 0;
      for (let k = 1; k <= 10; k++) {
        const tail = stops.slice(-k * 2);
        if (tail.length === k * 2 && tail.slice(0, k).join() === tail.slice(k).join()) { period = k; break; }
      }
      const modal = await p.evaluate(() => !!document.querySelector('dialog[open]:modal, [aria-modal="true"]'));
      if (period && period <= 3 && !modal) items.push({ kind: 'tab-trap', detail: `Tab cycles over ${stops.slice(-period).join(' ')}` });
    }
    if (distinct.size === 0 || (distinct.size === 1 && stops[0] === 'body')) items.push({ kind: 'tab-none', detail: 'Tab never focuses anything' });
    const order = [...distinct].filter(x => x !== 'body');
    items.push({ kind: 'info-tab', detail: `${order.length} stops${wrapped ? ', wraps' : ' (stopped at 80, no wrap)'}: ${order.slice(0, 15).join(' ')}${order.length > 15 ? ' …' : ''}` });
    if (/^r\d+$/.test(before)) await p.evaluate((r) => (window.__uid.resolve(r) as HTMLElement | null)?.focus?.(), before).catch(() => undefined);
    const s = await this.snap(p);
    this.setBase(s);
    return items;
  }

  // ------------------------------------------------------------------ screenshot

  private async screenshot(cmd: Extract<Command, { name: 'screenshot' }>): Promise<Reply> {
    const p = this.need();
    const file = path.resolve(cmd.path ?? path.join(this.sessionDir, 'shots', `shot-${++this.shots}.png`));
    mkdirSync(path.dirname(file), { recursive: true });
    if (cmd.ref) await (await this.handle(p, cmd.ref)).screenshot({ path: file });
    else await p.screenshot({ path: file, fullPage: !!cmd.full });
    return ok(`saved ${file}`);
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' ? u.pathname.split('/').pop() + u.hash : u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

/** Back to argv for the transcript (codegen parses argv). */
export function argvOf(cmd: Command): string[] {
  const c = cmd as Record<string, unknown>;
  switch (cmd.name) {
    case 'tick': return [cmd.on ? 'check' : 'uncheck', cmd.ref];
    case 'audit': return ['check', ...cmd.kinds];
    case 'click': return ['click', cmd.ref, ...(cmd.right ? ['--right'] : [])];
    case 'dblclick': case 'hover': return [cmd.name, cmd.ref];
    case 'type': case 'fill': return [cmd.name, cmd.ref, cmd.text, ...(cmd.enter ? ['--enter'] : [])];
    case 'press': return cmd.ref ? ['press', cmd.ref, cmd.key] : ['press', cmd.key];
    case 'select': return ['select', cmd.ref, cmd.option];
    case 'scroll': return ['scroll', ...(cmd.ref ? [cmd.ref] : []), ...(cmd.dir ? [cmd.dir] : []), ...(cmd.amount ? [String(cmd.amount)] : [])];
    case 'goto': return ['goto', cmd.url];
    case 'resize': return ['resize', `${cmd.width}x${cmd.height}`];
    case 'wait': {
      if (cmd.kind === 'ms') return ['wait', String(cmd.ms)];
      if (cmd.kind === 'idle') return ['wait', 'idle'];
      if (cmd.kind === 'ref') return ['wait', cmd.ref as string];
      if (cmd.kind === 'gone') return ['wait', 'gone', (cmd.ref ?? cmd.text) as string];
      return ['wait', cmd.kind, cmd.text ?? ''];
    }
    case 'snapshot': return ['snapshot', ...(cmd.scope ? [cmd.scope] : [])];
    case 'find': return ['find', cmd.text];
    case 'start': return ['start', ...(cmd.app ? [cmd.app] : []), ...(cmd.url ? ['--url', cmd.url] : [])];
    case 'page': return ['page', String(cmd.index)];
    case 'screenshot': return ['screenshot', ...(cmd.ref ? [cmd.ref] : [])];
    default: return [String(c.name)];
  }
}
