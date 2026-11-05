/**
 * Tests of the page runtime (src/page/runtime.js) in a real chromium: it needs
 * real layout, computed styles and hit testing, which no DOM shim gives.
 */
import { readFileSync } from 'node:fs';
import pw from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditKind, PageSnapshot, RawNode } from '../src/types.ts';

const SRC = readFileSync(new URL('../src/page/runtime.js', import.meta.url), 'utf8');

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await pw.chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});
beforeEach(async () => {
  page?.close().catch(() => {});
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
});

async function load(html: string): Promise<void> {
  await page.setContent(html);
  await page.evaluate(SRC);
}

// Functions passed to page.evaluate run in the page, where window.__uid exists
// (its type is declared by src/session.ts).
const snap = (o: object = {}) => page.evaluate((opts) => window.__uid.snap(opts), o) as Promise<PageSnapshot>;
const audit = (...kinds: AuditKind[]) => page.evaluate((k) => window.__uid.audit(k), kinds);

function all(n: RawNode, out: RawNode[] = []): RawNode[] {
  for (const k of n.children ?? []) {
    out.push(k);
    all(k, out);
  }
  return out;
}
const byRole = (s: PageSnapshot, role: string) => all(s.root).filter((n) => n.role === role);
const named = (s: PageSnapshot, name: string) => {
  const n = all(s.root).find((x) => x.name === name);
  if (!n) throw new Error(`no node named ${name}: ${JSON.stringify(s.root)}`);
  return n;
};

describe('roles, names, states', () => {
  it('names buttons from text, aria-label, and links', async () => {
    await load(`<button>Save</button><button aria-label="Close"><svg aria-hidden="true"></svg>x</button><a href="/x">Home</a><a>not a link</a>`);
    const s = await snap();
    expect(byRole(s, 'button').map((b) => b.name)).toEqual(['Save', 'Close']);
    expect(byRole(s, 'link').map((b) => b.name)).toEqual(['Home']);
    expect(all(s.root).some((n) => n.role === 'text' && n.name === 'not a link')).toBe(true);
  });

  it('names inputs from label[for], wrapping label, placeholder', async () => {
    await load(`<label for="a">First</label><input id="a"><label>Second <input></label><input placeholder="Third">`);
    const s = await snap();
    expect(byRole(s, 'textbox').map((b) => b.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('a label wrapping a select names it without the option texts; other embedded controls give their value', async () => {
    await load(`<label><span>Layout</span><select><option>Inline</option><option selected>Stacked</option></select></label>
      <label>Font size <select id="fs"><option>Small</option><option selected>Large</option></select></label>
      <label for="q">Find <input value="love"> in</label><input id="q">`);
    const s = await snap();
    expect(byRole(s, 'combobox').map((b) => b.name)).toEqual(['Layout', 'Font size']);
    expect(byRole(s, 'textbox').map((b) => b.name)).toContain('Find love in');
  });

  it('names images from alt and skips decorative ones', async () => {
    await load(`<img alt="Logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`);
    const imgs = byRole(await snap(), 'img');
    expect(imgs.map((i) => i.name)).toEqual(['Logo']);
  });

  it('gives headings their level', async () => {
    await load(`<h1>One</h1><h3>Three</h3><div role="heading" aria-level="4">Four</div>`);
    const h = byRole(await snap(), 'heading');
    expect(h.map((x) => [x.name, x.level])).toEqual([['One', 1], ['Three', 3], ['Four', 4]]);
  });

  it('shows select value, text value and hides password text', async () => {
    await load(`<select aria-label="Lang"><option>en</option><option selected>fr</option></select><input aria-label="Q" value="love"><input type="password" aria-label="P" value="secret">`);
    const s = await snap();
    expect(named(s, 'Lang')).toMatchObject({ role: 'combobox', value: 'fr' });
    expect(named(s, 'Q').value).toBe('love');
    expect(named(s, 'P').value).toBe('•••');
  });

  it('reports checkbox, expanded, disabled, focused, required states', async () => {
    await load(`<input type="checkbox" aria-label="A" checked><input type="checkbox" aria-label="B">
      <button aria-expanded="true">Open</button><button aria-expanded="false">Shut</button>
      <button disabled>Off</button><input aria-label="Req" required><button id="f">Focus me</button>`);
    await page.focus('#f');
    const s = await snap();
    expect(named(s, 'A').states).toEqual(['checked']);
    expect(named(s, 'B').states).toEqual(['unchecked']);
    expect(named(s, 'Open').states).toEqual(['expanded']);
    expect(named(s, 'Shut').states).toEqual(['collapsed']);
    expect(named(s, 'Off').states).toEqual(['disabled']);
    expect(named(s, 'Req').states).toEqual(['required']);
    expect(named(s, 'Focus me').states).toEqual(['focused']);
    expect(s.focus).toBe(named(s, 'Focus me').ref);
  });

  it('reports body focus when nothing is focused', async () => {
    await load(`<button>x</button>`);
    expect((await snap()).focus).toBe('body');
  });
});

describe('hidden content', () => {
  it('skips display:none, aria-hidden, hidden attribute and visibility:hidden', async () => {
    await load(`<button style="display:none">A</button><button aria-hidden="true">B</button><button hidden>C</button>
      <button style="visibility:hidden">D</button><button>Shown</button>`);
    expect(byRole(await snap(), 'button').map((b) => b.name)).toEqual(['Shown']);
  });

  it('keeps children of display:contents wrappers', async () => {
    await load(`<div style="display:contents"><button>Inside</button></div>`);
    expect(byRole(await snap(), 'button').map((b) => b.name)).toEqual(['Inside']);
  });
});

describe('text', () => {
  it('merges inline text runs into one line and splits at blocks', async () => {
    await load(`<p>Hello <b>big</b> <i>world</i></p><p>Second</p>`);
    const texts = all((await snap()).root).filter((n) => n.role === 'text').map((n) => n.name);
    expect(texts).toEqual(['Hello big world', 'Second']);
  });

  it('truncates long text and names', async () => {
    await load(`<p>${'word '.repeat(60)}</p><button>${'x'.repeat(100)}</button>`);
    const s = await snap();
    const t = all(s.root).find((n) => n.role === 'text')!;
    expect(t.name!.length).toBe(80);
    expect(t.name!.endsWith('…')).toBe(true);
    expect(byRole(s, 'button')[0].name!.length).toBe(60);
  });
});

describe('refs', () => {
  it('are stable across snapshots', async () => {
    await load(`<button>A</button><button>B</button><a href="#">C</a>`);
    const a = await snap();
    const b = await snap();
    expect(all(b.root).map((n) => n.ref)).toEqual(all(a.root).map((n) => n.ref));
    expect(new Set(all(a.root).map((n) => n.ref)).size).toBe(3);
  });

  it('are handed on to an identical replacement element', async () => {
    await load(`<div id="box"><button>Go</button></div>`);
    const a = await snap();
    await page.evaluate(() => {
      const box = document.getElementById('box')!;
      box.innerHTML = '<button>Go</button>';
    });
    const b = await snap();
    expect(byRole(b, 'button')[0].ref).toBe(byRole(a, 'button')[0].ref);
  });

  it('do not transfer to a different element', async () => {
    await load(`<div id="box"><button>Go</button></div>`);
    const a = await snap();
    await page.evaluate(() => { document.getElementById('box')!.innerHTML = '<button>Stop</button>'; });
    const b = await snap();
    expect(byRole(b, 'button')[0].ref).not.toBe(byRole(a, 'button')[0].ref);
  });

  it('resolve() finds a replaced element and returns null for a removed one', async () => {
    await load(`<div id="box"><button>Go</button></div><button id="other">Other</button>`);
    const a = await snap();
    const ref = byRole(a, 'button')[0].ref!;
    await page.evaluate(() => { document.getElementById('box')!.innerHTML = '<button id="new">Go</button>'; });
    expect(await page.evaluate((r) => window.__uid.resolve(r)?.id, ref)).toBe('new');
    await page.evaluate(() => { document.getElementById('box')!.remove(); });
    expect(await page.evaluate((r) => window.__uid.resolve(r) === null, ref)).toBe(true);
    expect(await page.evaluate(() => window.__uid.resolve('r999') === null)).toBe(true);
  });

  it('never repeat when nextRef is passed', async () => {
    await load(`<button>A</button>`);
    const a = await snap();
    await page.evaluate(() => { document.body.innerHTML = '<button>Different</button>'; });
    const b = await snap({ nextRef: a.nextRef });
    expect(Number(byRole(b, 'button')[0].ref!.slice(1))).toBeGreaterThanOrEqual(a.nextRef);
    expect(b.nextRef).toBeGreaterThan(a.nextRef);
  });

  it('adopt refs from a seed after a reload', async () => {
    await load(`<button>Go</button>`);
    const a = await snap({ nextRef: 50 });
    await load(`<button>Go</button>`); // fresh document: runtime restarts with no refs
    const b = await snap({ nextRef: a.nextRef, seed: a.sigs });
    expect(byRole(b, 'button')[0].ref).toBe(byRole(a, 'button')[0].ref);
  });
});

describe('snap options', () => {
  it('scopes to a ref', async () => {
    await load(`<button>Out</button><div role="dialog" aria-label="D"><button>In</button></div>`);
    const a = await snap();
    const dlg = byRole(a, 'dialog')[0].ref!;
    const s = await snap({ scope: dlg });
    expect(s.root.children).toHaveLength(1);
    expect(s.root.children![0]).toMatchObject({ role: 'dialog', ref: dlg });
    expect(byRole(s, 'button').map((b) => b.name)).toEqual(['In']);
  });

  it('returns an error for a stale scope', async () => {
    await load(`<button>Out</button>`);
    expect(await snap({ scope: 'r77' })).toEqual({ error: 'stale' });
  });

  it('visible-only skips off-screen content', async () => {
    await load(`<button>Top</button><div style="height:3000px"></div><button>Far</button>`);
    const all1 = await snap();
    expect(byRole(all1, 'button').map((b) => b.name)).toEqual(['Top', 'Far']);
    const vis = await snap({ visible: true });
    expect(byRole(vis, 'button').map((b) => b.name)).toEqual(['Top']);
  });
});

describe('hint', () => {
  it('gives testId when unique', async () => {
    await load(`<button data-testid="save">Save</button><button data-testid="dup">A</button><button data-testid="dup">A</button>`);
    const s = await snap();
    const [save, d1] = byRole(s, 'button');
    const h = await page.evaluate((r) => window.__uid.hint(r), save.ref!);
    expect(h).toMatchObject({ testId: 'save', role: 'button', name: 'Save' });
    expect(await page.evaluate((r) => window.__uid.hint(r)?.testId, d1.ref!)).toBeUndefined();
  });

  it('gives role and name, and nth for duplicates', async () => {
    await load(`<button>Same</button><button>Same</button><button>Other</button>`);
    const [a, b, c] = byRole(await snap(), 'button');
    expect(await page.evaluate((r) => window.__uid.hint(r), c.ref!)).toMatchObject({ role: 'button', name: 'Other' });
    const ha = await page.evaluate((r) => window.__uid.hint(r), a.ref!);
    const hb = await page.evaluate((r) => window.__uid.hint(r), b.ref!);
    expect(ha).toMatchObject({ role: 'button', name: 'Same', nth: 0 });
    expect(hb).toMatchObject({ role: 'button', name: 'Same', nth: 1 });
    expect(await page.evaluate((r) => window.__uid.hint(r)?.nth, c.ref!)).toBeUndefined();
  });

  it('returns null for an unknown ref', async () => {
    await load(`<button>x</button>`);
    await snap();
    expect(await page.evaluate(() => window.__uid.hint('r500'))).toBeNull();
  });
});

describe('audit', () => {
  it('finds an unnamed button', async () => {
    await load(`<button></button><button>Named</button>`);
    const s = await snap();
    const items = await audit('names');
    expect(items).toEqual([{ kind: 'unnamed', ref: byRole(s, 'button')[0].ref, detail: expect.any(String) }]);
  });

  it('finds a page that scrolls sideways', async () => {
    await load(`<div style="width:2000px;height:20px">wide</div>`);
    await snap();
    const items = await audit('overflow');
    expect(items.some((i) => i.kind === 'page-x')).toBe(true);
  });

  it('finds an element covered by an overlay', async () => {
    await load(`<button style="position:absolute;left:10px;top:10px;width:100px;height:40px">Under</button>
      <div style="position:fixed;left:0;top:0;width:300px;height:300px;background:#ccc"></div>`);
    const s = await snap();
    const items = await audit('overlap');
    expect(items).toContainEqual(expect.objectContaining({ kind: 'covered', ref: byRole(s, 'button')[0].ref }));
  });

  it('does not report content scrolled under a fixed bottom bar', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await load(`<button style="position:absolute;left:10px;top:690px;width:100px;height:40px">Row</button>
      <nav style="position:fixed;left:0;right:0;bottom:0;height:50px;background:#ccc"><button>Home</button></nav>`);
    await snap();
    const items = await audit('overlap');
    expect(items.filter((i: { kind: string }) => i.kind === 'covered' || i.kind === 'overlap')).toEqual([]);
  });

  it('does not report a clear button as covered', async () => {
    await load(`<button>Free</button>`);
    await snap();
    expect(await audit('overlap')).toEqual([]);
  });

  it('flags background controls of an open aria-modal dialog', async () => {
    await load(`<button>Behind</button><div role="dialog" aria-modal="true" aria-label="M"><button>Ok</button></div>`);
    await snap();
    const items = await audit('overlap');
    expect(items.some((i) => i.kind === 'modal-background')).toBe(true);
  });

  it('is quiet when the background of a modal is inert', async () => {
    await load(`<div inert><button>Behind</button></div><div role="dialog" aria-modal="true" aria-label="M"><button>Ok</button></div>`);
    await snap();
    expect((await audit('overlap')).some((i) => i.kind === 'modal-background')).toBe(false);
  });

  it('finds i18n keys and unresolved placeholders', async () => {
    await load(`<h2>settings.title</h2><p>You have {{count}} items</p><p>Welcome back</p><button aria-label="nav.menu_open">x</button>`);
    await snap();
    const details = (await audit('i18n')).map((i) => i.detail).join('\n');
    expect(details).toContain('settings.title');
    expect(details).toContain('{{count}}');
    expect(details).toContain('nav.menu_open');
    expect(details).not.toContain('Welcome back');
  });

  it('does not report screen-reader-only 1px text as clipped', async () => {
    await load(`<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">Skip to main content</span>
      <p>ok</p>`);
    await snap();
    expect((await audit('overflow')).filter((i) => i.kind === 'clipped')).toEqual([]);
  });

  it('does report real clipped text', async () => {
    await load(`<div style="width:60px;overflow:hidden;white-space:nowrap">A very long clipped label</div>`);
    await snap();
    expect((await audit('overflow')).some((i) => i.kind === 'clipped')).toBe(true);
  });
});

describe('settle', () => {
  it('resolves once the DOM is quiet', async () => {
    await load(`<div id="x"></div>`);
    const r = await page.evaluate(async () => {
      const p = window.__uid.settle(50, 2000);
      setTimeout(() => { document.getElementById('x')!.textContent = 'changed'; }, 10);
      return p;
    });
    expect(r.mutations).toBeGreaterThan(0);
    expect(r.ms).toBeLessThan(1500);
  });

  it('gives up at the cap when the DOM never stays quiet', async () => {
    await load(`<div id="x"></div>`);
    const r = await page.evaluate(async () => {
      const t = setInterval(() => { document.getElementById('x')!.textContent += '.'; }, 10);
      const res = await window.__uid.settle(100, 300);
      clearInterval(t);
      return res;
    });
    expect(r.ms).toBeLessThan(1000);
    expect(r.mutations).toBeGreaterThan(3);
  });
});
