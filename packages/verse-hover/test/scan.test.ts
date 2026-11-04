// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createScanner } from '../src/scan';
import { createDetector } from '../src/detect';
import { pack as en, chapters } from '../src/locales/en.generated';

const det = createDetector(en, chapters);

function make(opts: { scope?: string[] | string; skip?: string; observe?: boolean } = {}) {
  return createScanner({
    detect: (t) => det.detect(t),
    make: (r, text) => {
      const a = document.createElement('a');
      a.className = 'vh-ref';
      a.textContent = text;
      a.dataset.vhRef = `${r.book}:${r.chapter}:${r.verse ?? ''}`;
      return a;
    },
    mark: (el) => el.classList.add('vh-ref'),
    prefix: 'vh-',
    observe: opts.observe ?? false,
    ...opts,
  });
}

const refs = () => Array.from(document.querySelectorAll('a.vh-ref')).map((a) => a.textContent);

beforeEach(() => { document.body.innerHTML = ''; });

describe('scanner', () => {
  it('links references in text and keeps surrounding text', async () => {
    document.body.innerHTML = '<p>See John 3:16 and <b>Rom 8:28</b>.</p>';
    await make().scan();
    expect(refs()).toEqual(['John 3:16', 'Rom 8:28']);
    expect(document.body.textContent).toBe('See John 3:16 and Rom 8:28.');
  });

  it('skips code, links, buttons, scripts, textareas, contenteditable, translate=no, data-vh=off, .vh-skip', async () => {
    document.body.innerHTML = `<code>John 3:16</code><a href="#">John 3:16</a><button>John 3:16</button><textarea>John 3:16</textarea>
      <pre>John 3:16</pre><div contenteditable="true">John 3:16</div><div translate="no">John 3:16</div><div data-vh="off"><p>John 3:16</p></div>
      <span class="vh-skip">John 3:16</span><style>.x{}</style><p id="ok">John 3:16</p>`;
    await make().scan();
    expect(refs()).toEqual(['John 3:16']);
    expect(document.querySelector('#ok a')).not.toBeNull();
  });

  it('custom skip selector', async () => {
    document.body.innerHTML = '<h2>John 3:16</h2><p>John 3:16</p>';
    await make({ skip: 'h2' }).scan();
    expect(document.querySelectorAll('h2 a').length).toBe(0);
    expect(document.querySelectorAll('p a').length).toBe(1);
  });

  it('scope: only text inside matching elements is scanned', async () => {
    document.body.innerHTML = '<p>John 3:16</p><article class="a"><p>Rom 8:28</p><section class="a">Heb 11:1</section></article><div class="a">Acts 2:38</div>';
    await make({ scope: ['article.a', 'div.a'] }).scan();
    expect(refs()).toEqual(['Rom 8:28', 'Heb 11:1', 'Acts 2:38']);
    expect(document.querySelector('body > p a')).toBeNull();
  });

  it('scope as a string and with no match scans nothing', async () => {
    document.body.innerHTML = '<p>John 3:16</p>';
    await make({ scope: '.nope' }).scan();
    expect(refs()).toEqual([]);
  });

  it('unscan restores the exact original DOM and the original text nodes', async () => {
    document.body.innerHTML = '<p>See John 3:16 and <b>Rom 8:28</b>.</p><p>No refs 12</p>';
    const before = document.body.innerHTML;
    const texts = Array.from(document.querySelectorAll('p')).map((p) => p.firstChild);
    const s = make();
    await s.scan();
    expect(document.body.innerHTML).not.toBe(before);
    s.unscan();
    expect(document.body.innerHTML).toBe(before);
    expect(document.body.querySelectorAll('p')[0].firstChild).toBe(texts[0]);
    document.body.normalize();
  });

  it('unscan of a sub-tree only restores that sub-tree', async () => {
    document.body.innerHTML = '<div id="a">John 3:16</div><div id="b">Rom 8:28</div>';
    const s = make();
    await s.scan();
    s.unscan(document.getElementById('a')!);
    expect(refs()).toEqual(['Rom 8:28']);
  });

  it('does not rescan its own links', async () => {
    document.body.innerHTML = '<p>John 3:16</p>';
    const s = make();
    await s.scan();
    await s.scan();
    expect(refs()).toEqual(['John 3:16']);
  });

  it('manual data-vh-ref markup is marked without detection', async () => {
    document.body.innerHTML = '<p>Read <span data-vh-ref="43003016">the famous verse</span></p>';
    await make().scan();
    expect(document.querySelector('span')!.classList.contains('vh-ref')).toBe(true);
  });

  it('observer picks up inserted nodes and ignores its own insertions', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const s = make({ observe: true });
    await s.scan();
    s.watch();
    const p = document.createElement('p');
    p.textContent = 'Later: Phil 4:13';
    document.getElementById('root')!.appendChild(p);
    await new Promise((r) => setTimeout(r, 400));
    expect(refs()).toEqual(['Phil 4:13']);
    await new Promise((r) => setTimeout(r, 300));
    expect(refs()).toEqual(['Phil 4:13']);
    s.destroy();
    expect(refs()).toEqual([]);
  });

  it('observer respects scope', async () => {
    document.body.innerHTML = '<div class="in"></div><div class="out"></div>';
    const s = make({ observe: true, scope: '.in' });
    await s.scan();
    s.watch();
    document.querySelector('.in')!.insertAdjacentHTML('beforeend', '<p>Phil 4:13</p>');
    document.querySelector('.out')!.insertAdjacentHTML('beforeend', '<p>Rom 8:28</p>');
    await new Promise((r) => setTimeout(r, 400));
    expect(refs()).toEqual(['Phil 4:13']);
    s.destroy();
  });

  it('a large synthetic page finishes', async () => {
    const para = '<p>Some words 12 and more words. See John 3:16 and then Rom 8:28 for more, in 2020 it was 5 apples.</p>';
    document.body.innerHTML = para.repeat(4000);
    const t = performance.now();
    const n = await make().scan();
    expect(n).toBe(8000);
    expect(performance.now() - t).toBeLessThan(20000);
  });
});
