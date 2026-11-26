/**
 * Every `audio.*` key the desktop code uses exists in the English catalog, every locale has the same keys, and a
 * translated string uses the same `{parameters}` as the English one (a missing one silently drops words).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UI_SRC = resolve(__dirname, '../../..');
const LOCALES = resolve(__dirname, '../../../../../locales');
const load = (locale: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALES, locale, 'audio.json'), 'utf8'));

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') files(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'audioTestRig.tsx') out.push(p);
  }
  return out;
}

const params = (s: string) => [...s.matchAll(/\{(\w+)(?:,|\})/g)].map((m) => m[1]).sort();

describe('audio locale keys (desktop)', () => {
  const english = load('en');

  it('every literal key used in the audio code and the shortcuts dialog is in the English catalog', () => {
    const used = new Set<string>();
    const sources = [...files(join(UI_SRC, 'modules/audio')), join(UI_SRC, 'components/KeyboardShortcutsDialog.tsx')];
    for (const f of sources) {
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](audio\.[A-Za-z]+(?:\.[A-Za-z-]+)*)['"`]/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in english) && !Object.keys(english).some((e) => e.startsWith(`${k}.`)));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(40);
  });

  it('has a message for every error code the store can show, and for each quality', () => {
    for (const code of ['network', 'not-found', 'decode', 'unsupported', 'engine', 'autoplay', 'unknown']) {
      expect(english[`audio.error.${code}`], code).toBeTruthy();
    }
    for (const q of ['low', 'medium', 'high']) expect(english[`audio.settings.quality.${q}`]).toBeTruthy();
  });

  it('says nothing about a browser or AI, and never "we"', () => {
    for (const text of Object.values(english)) expect(text).not.toMatch(/\bbrowser\b|\bAI\b|\bwe\b|\bour\b/i);
  });

  const locales = readdirSync(LOCALES).filter((l) => existsSync(join(LOCALES, l, 'audio.json')) && l !== 'en');
  it('is present for every locale folder', () => {
    const all = readdirSync(LOCALES).filter((l) => statSync(join(LOCALES, l)).isDirectory());
    expect(locales.sort()).toEqual(all.filter((l) => l !== 'en').sort());
  });

  it.each(locales)('%s has the same keys and parameters as English', (locale) => {
    const translated = load(locale);
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    if (locale === 'xx-pseudo' || locale === 'xx-rtl') return; // generated
    for (const [key, text] of Object.entries(english)) expect(params(translated[key]), key).toEqual(params(text));
  });
});
