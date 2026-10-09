// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, parseTemplate, fillText, escapeHtml } from '../src/render';
import { plan } from '../src/popup';
import { css } from '../src/style';
import type { Config, Ref, RenderContext } from '../src/types';

const o = { P: 'vh-', block: false, numbers: true, version: true, headings: true, closeLabel: 'Close', linkLabel: 'Read' };
const ctx = (verses: RenderContext['verses'], extra: Partial<RenderContext> = {}): RenderContext => ({
  ref: { book: 43, chapter: 3, verse: 16, start: 0, end: 0, score: 100 }, refText: 'John 3:16', version: 'KJV', versionName: 'King James', verses, dir: 'ltr', lang: 'en', ...extra,
});
const host = (f: DocumentFragment) => { const d = document.createElement('div'); d.appendChild(f); return d; };

describe('render', () => {
  it('fills the default template', () => {
    const d = host(render(parseTemplate(undefined, 'vh-'), ctx([{ n: 16, text: 'For God so loved the world', target: true }], { link: 'https://x/', copyright: 'PD' }), o));
    expect(d.querySelector('.vh-pop__ref')!.textContent).toBe('John 3:16');
    expect(d.querySelector('.vh-pop__ver')!.textContent).toBe('KJV');
    expect(d.querySelector('.vh-v--target .vh-v__text')!.textContent).toBe('For God so loved the world');
    expect(d.querySelector('.vh-v__num')!.textContent).toBe('16');
    expect((d.querySelector('.vh-pop__link') as HTMLAnchorElement).getAttribute('href')).toBe('https://x/');
    expect(d.querySelector('.vh-pop__copy')!.textContent).toBe('PD');
    expect(d.querySelector('[data-vh-slot=close]')!.getAttribute('aria-label')).toBe('Close');
  });
  it('removes slots with no data', () => {
    const d = host(render(parseTemplate(undefined, 'vh-'), ctx([{ n: 1, text: 'x', target: true }]), { ...o, version: false, numbers: false }));
    expect(d.querySelector('.vh-pop__link')).toBeNull();
    expect(d.querySelector('.vh-pop__copy')).toBeNull();
    expect(d.querySelector('.vh-pop__ver')).toBeNull();
    expect(d.querySelector('.vh-v__num')).toBeNull();
    expect(d.querySelector('.vh-pop__status')).toBeNull();
  });
  it('renders formatted segments as classed spans, text only', () => {
    const el = document.createElement('span');
    fillText(el, ['In ', ['d', '<i>LORD</i>'], ' said ', ['sw', 'x']], 'vh-');
    expect(el.querySelectorAll('i').length).toBe(0);
    expect(el.querySelector('.vh-w-d')!.textContent).toBe('<i>LORD</i>');
    expect(el.querySelector('.vh-w-s.vh-w-w')!.textContent).toBe('x');
  });
  it('XSS: hostile verse text, headings and copyright stay text', () => {
    const evil = '<img src=x onerror="window.__x=1"><script>window.__x=2</script>';
    const d = host(render(parseTemplate(undefined, 'vh-'), ctx([{ n: 1, text: evil, target: true, heading: evil }], { copyright: evil, versionName: evil }), o));
    expect(d.querySelectorAll('img,script').length).toBe(0);
    expect(d.textContent).toContain('<img src=x');
    expect((window as any).__x).toBeUndefined();
  });
  it('custom template: repeats the verse slot; block layout adds <br> for inline verse elements', () => {
    const t = parseTemplate('<div data-vh-slot="verses"><i data-vh-slot="verse"><b data-vh-slot="num"></b><u data-vh-slot="text"></u></i></div>', 'vh-');
    const d = host(render(t, ctx([{ n: 1, text: 'a', target: true }, { n: 2, text: 'b', target: false }]), { ...o, block: true }));
    expect(d.querySelectorAll('i').length).toBe(2);
    expect(d.querySelectorAll('br').length).toBe(1);
    expect(d.querySelectorAll('.vh-v--ctx').length).toBe(1);
  });
  it('headings only when enabled', () => {
    const d = host(render(parseTemplate(undefined, 'vh-'), ctx([{ n: 1, text: 'x', target: true, heading: 'A Psalm of David.' }]), { ...o, headings: false }));
    expect(d.querySelector('.vh-h')).toBeNull();
  });
  it('escapeHtml escapes the five characters', () => expect(escapeHtml(`<a href="x" t='y'>&`)).toBe('&#60;a href=&#34;x&#34; t=&#39;y&#39;&#62;&#38;'));
  it('template by #id', () => {
    document.body.innerHTML = '<template id="t1"><p data-vh-slot="ref"></p></template>';
    const d = host(render(parseTemplate('#t1', 'vh-'), ctx([]), o));
    expect(d.querySelector('p')!.textContent).toBe('John 3:16');
  });
});

describe('plan (which verses to request)', () => {
  const cfg = (c: Partial<Config>) => ({ context: 0, chapterPreview: 5, ...c }) as Config;
  const ref = (x: Partial<Ref>): Ref => ({ book: 43, chapter: 3, start: 0, end: 0, score: 100, ...x });
  it('single verse gets context, clipped at verse 1', () => {
    expect(plan(ref({ verse: 2 }), cfg({ context: { before: 3, after: 1 } }))).toEqual([{ ch: 3, from: 1, to: 3, tf: 2, tt: 2 }]);
  });
  it('ranges get no context', () => {
    expect(plan(ref({ verse: 14, endVerse: 18 }), cfg({ context: 2 }))).toEqual([{ ch: 3, from: 14, to: 18, tf: 14, tt: 18 }]);
  });
  it('never crosses a chapter: a cross-chapter range is two requests', () => {
    const p = plan(ref({ verse: 35, endChapter: 4, endVerse: 3 }), cfg({ context: 2 }), 36);
    expect(p.map((s) => [s.ch, s.from, s.to])).toEqual([[3, 35, 36], [4, 1, 3]]);
  });
  it('chapter-only previews the first verses', () => {
    expect(plan(ref({}), cfg({ chapterPreview: 3 }))).toEqual([{ ch: 3, from: 1, to: 3, tf: 1, tt: 3 }]);
  });
});

describe('default CSS', () => {
  const text = css('vh-');
  it('lives in @layer and every selector is :where() (specificity 0)', () => {
    expect(text.startsWith('@layer vh{')).toBe(true);
    const sels = text.replace(/@media[^{]*\{/g, '').split('}').map((r) => r.split('{')[0].trim()).filter((s) => s && !s.startsWith('@layer'));
    for (const s of sels) expect(s.startsWith(':where('), s).toBe(true);
  });
  it('words of Christ are red with an opt-out', () => {
    expect(text).toMatch(/w-w\)\{color:var\(--vh-words\)\}/);
    expect(text).toMatch(/nowoc/);
    expect(text).toContain('--vh-words:#b3261e');
  });
});
