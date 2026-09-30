// S8: proves the guard in eslint.config.mjs actually rejects what it claims to.
// A guard that silently stopped matching would let banned APIs into the package.
// The fixtures are linted as text under a virtual src/ path; nothing is written to disk.
import { ESLint } from 'eslint';
import { resolve } from 'path';

const eslint = new ESLint({ cwd: resolve(__dirname, '..') });

async function ruleIds(code: string, file = 'src/fixture.tsx'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(__dirname, '..', file) });
  return result.messages.map((m) => `${m.ruleId}: ${m.message}`);
}

describe('packages/ui eslint guard', () => {
  it('accepts clean code', async () => {
    const code = `import { useState } from 'react';
import { x } from '@bible/core/browser';
export const A = () => { const [v] = useState(x); return <div className="kth-card kth-x">{v}</div>; };`;
    expect(await ruleIds(code)).toEqual([]);
  });

  const banned: Array<[string, string, RegExp]> = [
    ['React 19-only hook', `import { useTransition } from 'react'; export const a = useTransition;`, /useTransition/],
    ['react-dom flushSync', `import { flushSync } from 'react-dom'; export const a = flushSync;`, /flushSync/],
    ['namespace access to a banned hook', `import * as React from 'react'; export const a = React.useDeferredValue;`, /React 18 subset/],
    ['zustand', `import { create } from 'zustand'; export const a = create;`, /No stores/],
    ['i18next', `import i18n from 'i18next'; export const a = i18n;`, /i18n/],
    ['@bible/core barrel', `import { x } from '@bible/core'; export const a = x;`, /@bible\/core\/browser/],
    ['other core subpath', `import { x } from '@bible/core/db'; export const a = x;`, /Only @bible\/core\/browser/],
    ['preact', `import { h } from 'preact'; export const a = h;`, /preact/],
    ['app import', `import { x } from '../../../apps/web/src/x'; export const a = x;`, /app code/],
    ['dangerouslySetInnerHTML', `export const a = <div dangerouslySetInnerHTML={{ __html: 'x' }} />;`, /dangerouslySetInnerHTML/],
    ['innerHTML assignment', `export const a = (e: HTMLElement) => { e.innerHTML = 'x'; };`, /innerHTML/],
    ['eval', `export const a = () => eval('1');`, /eval/],
    ['non-kth class literal', `export const a = <div className="kth-ok flex" />;`, /kth-\*/],
    ['localStorage', `export const a = () => localStorage.getItem('k');`, /localStorage/],
    ['fetch', `export const a = () => fetch('/x');`, /fetch/],
  ];

  it.each(banned)('rejects %s', async (_name, code, pattern) => {
    const messages = await ruleIds(code);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toMatch(pattern);
  });
});
