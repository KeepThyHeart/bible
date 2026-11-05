/** The static /watch join page (apps/web/present/watch.html): the code field is labelled and the page heading takes focus. */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(__dirname, '../../../../../present/watch.html'), 'utf8');
const bodyHtml = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const script = /<script>([\s\S]*?)<\/script>/.exec(bodyHtml)![1];

function load() {
  document.body.innerHTML = bodyHtml.replace(/<script>[\s\S]*?<\/script>/, '');
  (document.activeElement as HTMLElement | null)?.blur?.();
  new Function(script)();
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('watch.html', () => {
  it('names the code input with the visible prompt, not only its placeholder', () => {
    load();
    const input = document.getElementById('code') as HTMLInputElement;
    const label = document.querySelector('label[for="code"]');
    expect(label?.textContent).toBe('Enter the code you were given.');
    expect(input.labels?.[0]).toBe(label);
  });

  it('focuses the page heading when nothing has focus', () => {
    load();
    expect(document.activeElement).toBe(document.getElementById('heading'));
    expect(document.getElementById('heading')?.getAttribute('tabindex')).toBe('-1');
  });
});
