/**
 * Every `audio.*` locale key the code uses exists in the English catalog, every
 * locale has the same keys, and a translated string uses the same `{parameters}`
 * as the English one (a missing parameter silently drops words from a sentence).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import en from '../locales/en/ui.json';
import es from '../locales/es/ui.json';
import zh from '../locales/zh-Hans/ui.json';

const SRC = resolve(__dirname, '..');

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'locales' && name !== 'node_modules') files(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'uiRig.ts' && name !== 'audioShortcuts.ts') out.push(p); // (the shortcut ids look like keys)
  }
  return out;
}

function flatten(node: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === 'string') out[prefix] = node;
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const audioOf = (catalog: unknown) => flatten((catalog as { audio: unknown }).audio, 'audio');
const params = (s: string) => [...s.matchAll(/\{(\w+)(?:,|\})/g)].map(m => m[1]).sort();

describe('audio locale keys', () => {
  const english = audioOf(en);

  it('every literal key used in the code is in the English catalog', () => {
    const used = new Set<string>();
    for (const f of files(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](audio\.[A-Za-z]+(?:\.[A-Za-z-]+)*)['"`]/g)) used.add(m[1]);
    }
    const missing = [...used].filter(k => !(k in english) && !Object.keys(english).some(e => e.startsWith(`${k}.`)));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(40);
  });

  it('has a message for every error code the store can show, and for each quality', () => {
    for (const code of ['network', 'not-found', 'decode', 'unsupported', 'engine', 'autoplay', 'unknown']) {
      expect(english[`audio.error.${code}`], code).toBeTruthy();
    }
    for (const q of ['low', 'medium', 'high']) expect(english[`audio.settings.quality.${q}`]).toBeTruthy();
  });

  it.each([['es', es], ['zh-Hans', zh]])('%s has the same keys and parameters as English', (_name, catalog) => {
    const translated = audioOf(catalog);
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) expect(params(translated[key]), key).toEqual(params(text));
  });
});
