/**
 * Locale parity: every real locale must define every key that `en` defines
 * (B-148). English is the source of truth; missing keys silently fall back to
 * English in the UI, which is how a privacy-consent dialog once shipped
 * untranslated. Generated pseudo-locales (`xx-*`) are produced by
 * scripts/i18n-pseudo.js and are excluded. Same check as `pnpm check:translations`.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../locales');

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    if (k === '$schema') return [];
    const key = prefix ? `${prefix}.${k}` : k;
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, key)
      : [key];
  });
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
const isDir = (p: string) => fs.statSync(p).isDirectory();
const locales = fs
  .readdirSync(ROOT)
  .filter((d) => d !== 'en' && !d.startsWith('xx-') && d !== 'schemas' && isDir(path.join(ROOT, d)));
const namespaces = fs.readdirSync(path.join(ROOT, 'en')).filter((f) => f.endsWith('.json'));

describe('desktop locale parity with en', () => {
  it('finds locales to check', () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  for (const locale of locales) {
    it(`${locale} has every key that en has`, () => {
      const missing: string[] = [];
      for (const ns of namespaces) {
        const file = path.join(ROOT, locale, ns);
        const have = new Set(fs.existsSync(file) ? flatten(readJson(file)) : []);
        for (const key of flatten(readJson(path.join(ROOT, 'en', ns)))) {
          if (!have.has(key)) missing.push(`${ns}: ${key}`);
        }
      }
      expect(missing).toEqual([]);
    });
  }
});
