/** Every `notifications.*` key exists in all three locales with the same `{parameters}`, and the code's literal keys exist. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../../locales/en/notifications.json';
import es from '../../locales/es/notifications.json';
import zh from '../../locales/zh-Hans/notifications.json';

function flatten(node: unknown, prefix: string, out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === 'string') out[prefix] = node;
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) flatten(v, `${prefix}.${k}`, out);
  return out;
}
const of = (c: unknown) => flatten((c as { notifications: unknown }).notifications, 'notifications');
const params = (s: string) => [...s.matchAll(/\{(\w+)(?:,|\})/g)].map(m => m[1]).sort();

describe('notifications locale keys', () => {
  const english = of(en);

  it('every locale has the same keys with the same parameters', () => {
    for (const [name, catalog] of [['es', es], ['zh-Hans', zh]] as const) {
      const other = of(catalog);
      expect(Object.keys(other).sort(), name).toEqual(Object.keys(english).sort());
      for (const k of Object.keys(english)) expect(params(other[k]), `${name} ${k}`).toEqual(params(english[k]));
    }
  });

  it('literal keys used by the code exist', () => {
    for (const f of ['votdSource.ts', 'webReminders.ts']) {
      const src = readFileSync(resolve(__dirname, f), 'utf8');
      for (const m of src.matchAll(/['"`](notifications\.[A-Za-z.]+)['"`]/g)) expect(english, m[1]).toHaveProperty([m[1]]);
    }
  });

  it('the tab label keys cover the shared component labels', () => {
    const tab = readFileSync(resolve(__dirname, 'NotificationsSettingsTab.tsx'), 'utf8');
    const used = [...tab.matchAll(/'(\w+)'/g)].map(m => `notifications.labels.${m[1]}`).filter(k => k in english);
    expect(used.length).toBe(23);
  });
});
