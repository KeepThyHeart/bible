/**
 * B-186: the Word study namespace shipped as English placeholders in ar/hi/pt-BR/ru, so the Arabic UI showed an
 * English pane. Every real locale must translate every wordStudy string (parity alone only checks that keys exist).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../locales');
const read = (l: string) => JSON.parse(fs.readFileSync(path.join(ROOT, l, 'wordStudy.json'), 'utf8')) as Record<string, string>;
const locales = fs.readdirSync(ROOT).filter((d) => d !== 'en' && !d.startsWith('xx-') && fs.existsSync(path.join(ROOT, d, 'wordStudy.json')));

describe('wordStudy catalogs are translated', () => {
  const en = read('en');
  it('en defines the unknown-number notice', () => {
    expect(en['wordStudy.label.noticeUnknownNumber']).toBeTruthy();
  });
  for (const locale of locales) {
    it(`${locale} has no untranslated (English) wordStudy strings`, () => {
      const cat = read(locale);
      const same = Object.keys(en).filter((k) => cat[k] === en[k]);
      expect(same).toEqual([]);
    });
    it(`${locale} keeps the same placeholders as en`, () => {
      const cat = read(locale);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      for (const k of Object.keys(en)) expect(ph(cat[k] ?? ''), k).toBe(ph(en[k]));
    });
  }
});
