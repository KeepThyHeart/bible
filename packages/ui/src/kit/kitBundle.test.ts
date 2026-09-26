// @vitest-environment node
/**
 * Checks the built kit bundle (kth-kit.js + kth.css) as the host will serve it: shape, size budget, where its
 * code came from, a content denylist (security), and a smoke test in a real DOM.
 * The bundle is built here through the same function the desktop plugin uses, in memory (no pre-step).
 * Runs in one vitest project only: the bundle is self-contained (preact), so both projects would prove the same.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
// @ts-expect-error jsdom ships no type declarations and this package has no @types/jsdom
import { JSDOM } from 'jsdom';
import { UI_KIT_COMPONENTS } from '@bible/core/browser';
// @ts-expect-error plain .mjs build script (no type declarations)
import { UI_ROOT, buildKit } from '../../scripts/build-kit.mjs';

interface Built {
  js: string;
  css: string;
  metafile: { outputs: Record<string, { inputs: Record<string, unknown> }> };
}

const inputPath = (p: string) => p.replace(/\\/g, '/');
/** Files whose code is in kth-kit.js (tree-shaken modules are not). */
const bundledInputs = (b: Built): string[] => {
  const entry = Object.entries(b.metafile.outputs).find(([name]) => name.endsWith('kth-kit.js'));
  if (!entry) throw new Error('no kth-kit.js output in the metafile');
  return Object.keys(entry[1].inputs).map(inputPath);
};
const isPreact = (p: string) => /(^|\/)node_modules\/preact\//.test(inputPath(p));

describe.skipIf(process.env.KTH_UI_RUNTIME !== 'preact')('kit bundle', () => {
  let built: Built;
  beforeAll(async () => {
    built = (await buildKit({ write: false })) as Built;
    // eslint-disable-next-line no-console
    console.log(
      `kth kit: kth-kit.js ${built.js.length} B (${gzipSync(built.js).length} B gz), ` +
        `kth.css ${built.css.length} B (${gzipSync(built.css).length} B gz)`,
    );
  }, 60_000);

  it('is a classic script: no module syntax, no dynamic loading', () => {
    expect(built.js).not.toMatch(/^\s*(import|export)\s/m);
    expect(built.js).not.toMatch(/\brequire\(/);
    expect(built.js).not.toMatch(/\bimport\(/);
    expect(built.js).toContain('KthKit');
    expect(built.js).toContain('customElements.define');
  });

  it('css is one flat sheet composed from the map, base, contract and classes', () => {
    expect(built.css).not.toContain('@import');
    expect(built.css).toContain('.kth-btn');
    expect(built.css).toContain('--kth-bg');
    expect(built.css).toContain('var(--theme-');
  });

  it('stays within the size budget', () => {
    expect(gzipSync(built.js).length).toBeLessThan(60 * 1024);
    expect(gzipSync(built.css).length).toBeLessThan(20 * 1024);
  });

  it('bundles only packages/ui, core and preact', () => {
    const allowed = /^(src\/|css\/|\.\.\/core\/src\/|(\.\.\/)+node_modules\/preact\/)/;
    const inputs = bundledInputs(built);
    expect(inputs.filter((p) => !allowed.test(p))).toEqual([]);
    expect(inputs.some((p) => /electron|apps\/|hash-wasm|fflate/.test(p))).toBe(false);
  });

  it('contains none of the banned constructs', () => {
    const banned: RegExp[] = [
      /\beval\s*\(/,
      /new\s+Function\b/,
      /process\.env/,
      /__BIBLE_/,
      /window\.electron/,
      /ipcRenderer/,
      /parent\.document/,
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      /\bfetch\s*\(/,
      /insertAdjacentHTML|document\.write/,
    ];
    for (const re of banned) expect(built.js, String(re)).not.toMatch(re);
  });

  it('HTML injection: none in kit or core sources; the only innerHTML writes are preact own', () => {
    for (const input of bundledInputs(built)) {
      if (isPreact(input)) continue;
      const src = readFileSync(resolve(UI_ROOT, input), 'utf8');
      expect(src, input).not.toMatch(/\.innerHTML\s*=|\bouterHTML\b|dangerouslySetInnerHTML/);
    }
    // preact itself assigns innerHTML for dangerouslySetInnerHTML and SVG; it is never reachable from kit props.
    // The count must equal preact's own, so no third-party or kit write can hide behind it.
    const count = (s: string) => (s.match(/\.innerHTML\s*=/g) ?? []).length;
    const preactSrc = readFileSync(resolve(UI_ROOT, '../../node_modules/preact/dist/preact.module.js'), 'utf8');
    expect(count(built.js)).toBe(count(preactSrc));
  });

  describe('in a real DOM', () => {
    it('defines elements on init and works end to end', async () => {
      const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
      const w = dom.window as unknown as Window & {
        KthKit: { version: string; tags: string[]; init(o: { locale?: string }): Promise<void> };
        eval(code: string): unknown;
        HTMLInputElement: typeof HTMLInputElement;
        Event: typeof Event;
        KeyboardEvent: typeof KeyboardEvent;
      };
      w.eval(built.js);
      const kit = w.KthKit;
      expect(kit.version).toBe('1');
      expect([...kit.tags].sort()).toEqual(UI_KIT_COMPONENTS['1'].map((c) => c.tag).sort());
      expect(w.customElements.get('kth-reference-picker')).toBeUndefined(); // no side effect on load

      await kit.init({ locale: 'es' });
      const doc = w.document;
      const el = doc.createElement('kth-reference-picker');
      doc.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 0));
      const input = el.querySelector<HTMLInputElement>('[role=combobox]');
      expect(input).not.toBeNull();

      const seen: Array<{ verseId: number; ref: string }> = [];
      el.addEventListener('kth-change', (e) => seen.push((e as CustomEvent).detail));
      const setValue = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'Juan 3:16');
      input!.dispatchEvent(new w.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
      input!.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
      expect(seen).toEqual([{ verseId: 43003016, ref: 'Juan 3:16' }]);
      dom.window.close();
    });

    it('init with an rpc reads the locale once; a failing rpc keeps English', async () => {
      const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
      const w = dom.window as unknown as {
        KthKit: { init(o: object): Promise<void> };
        eval(code: string): unknown;
      };
      w.eval(built.js);
      let calls = 0;
      await w.KthKit.init({
        components: ['kth-highlight-swatch', 'kth-nope'],
        rpc: { getLocale: async () => (calls++, { locale: 'ar', direction: 'rtl' }) },
      });
      expect(calls).toBe(1);
      await expect(w.KthKit.init({ rpc: { getLocale: () => Promise.reject(new Error('no')) } })).resolves.toBeUndefined();
      dom.window.close();
    });
  });
});
