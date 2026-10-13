/** Every `accounts.*` key exists in all six locales with the same `{parameters}`, and the code's literal keys exist. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../../locales/en/accounts.json';
import es from '../../locales/es/accounts.json';
import ar from '../../locales/ar/accounts.json';
import fa from '../../locales/fa-IR/accounts.json';
import he from '../../locales/he-IL/accounts.json';
import zh from '../../locales/zh-Hans/accounts.json';
import { ACCOUNTS_FAILURES } from './errors';
import { accountLabelKeys } from './labels';
import { FEEDBACK_KEYS } from './AccountScreens';

function flatten(node: unknown, prefix: string, out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === 'string') out[prefix] = node;
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) flatten(v, `${prefix}.${k}`, out);
  return out;
}
const of = (c: unknown) => flatten((c as { accounts: unknown }).accounts, 'accounts');
const params = (s: string) => [...s.matchAll(/\{(\w+)(?:,|\})/g)].map((m) => m[1]).sort();

describe('accounts locale keys', () => {
  const english = of(en);

  it('every locale has the same keys with the same parameters and no empty string', () => {
    for (const [name, catalog] of [['es', es], ['ar', ar], ['fa-IR', fa], ['he-IL', he], ['zh-Hans', zh]] as const) {
      const other = of(catalog);
      expect(Object.keys(other).sort(), name).toEqual(Object.keys(english).sort());
      for (const k of Object.keys(english)) {
        expect(params(other[k]), `${name} ${k}`).toEqual(params(english[k]));
        expect(other[k].trim(), `${name} ${k}`).not.toBe('');
      }
    }
  });

  it('has a string for every shared component label', () => {
    for (const key of accountLabelKeys()) expect(english, key).toHaveProperty([key]);
  });

  it('has a message for every failure token and feedback key', () => {
    for (const token of ACCOUNTS_FAILURES) expect(english, token).toHaveProperty([`accounts.error.${token}`]);
    for (const key of FEEDBACK_KEYS) expect(english, key).toHaveProperty([`accounts.feedback.${key}`]);
  });

  it('literal keys used by the code exist', () => {
    for (const f of ['AccountScreens.tsx', 'AccountDialog.tsx', 'AccountSettingsView.tsx', 'HeaderSyncBadge.tsx']) {
      const src = readFileSync(resolve(__dirname, f), 'utf8');
      for (const m of src.matchAll(/['"`](accounts\.[A-Za-z0-9.]+)['"`]/g)) {
        if (m[1].endsWith('.')) continue;
        expect(english, `${f}: ${m[1]}`).toHaveProperty([m[1]]);
      }
    }
  });
});
