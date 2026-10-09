/**
 * The English written beside every `tr()` / `tc()` call must equal the `en` catalog entry, and
 * every catalog key must have a user (task 0114 M3). Without this the built-in fallback and the
 * catalog drift apart.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');
const LOCALES = resolve(__dirname, '../../../apps/desktop/locales');
const CALL = /\b(?:tr|tc)\(\s*'([^'\n]+)'\s*,\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g;
/** Keys the desktop host code looks up itself (badge, notices, reminder source label). */
const HOST_KEYS = ['memory.badge.due', 'memory.badge.waiting', 'memory.notice.retired', 'memory.notice.skipped', 'memory.reminderSource.label'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
}

function used(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(CALL)) {
      const english = new Function(`return ${m[2]}`)() as string;
      (out.get(m[1]!) ?? out.set(m[1]!, new Set()).get(m[1]!)!).add(english);
    }
  }
  return out;
}

const en = JSON.parse(readFileSync(join(LOCALES, 'en/memory.json'), 'utf8')) as Record<string, string>;

describe('memory catalog', () => {
  it('every call site agrees with the en catalog', () => {
    const calls = used();
    expect(calls.size).toBeGreaterThan(300);
    const problems: string[] = [];
    for (const [key, texts] of calls) {
      if (texts.size > 1) problems.push(`${key}: ${texts.size} different English texts`);
      else if (!(key in en)) problems.push(`${key}: missing from en/memory.json`);
      else if (en[key] !== [...texts][0]) problems.push(`${key}: en catalog says ${JSON.stringify(en[key])}, code says ${JSON.stringify([...texts][0])}`);
    }
    expect(problems).toEqual([]);
  });

  it('every catalog key is used by the code or by the desktop host', () => {
    const calls = used();
    expect(Object.keys(en).filter((k) => !calls.has(k) && !HOST_KEYS.includes(k))).toEqual([]);
  });

  it('every locale has exactly the keys of en, with the same placeholders', () => {
    const names = (s: string) => [...s.matchAll(/(?<!(?:one|other|few|many|two|zero|=\d+)\s*)\{(\w+)\s*[,}]/g)].map((m) => m[1]!);
    const uniq = (s: string) => [...new Set(names(s))].sort().join(',');
    for (const locale of readdirSync(LOCALES, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('xx-')).map((e) => e.name)) {
      const catalog = JSON.parse(readFileSync(join(LOCALES, locale, 'memory.json'), 'utf8')) as Record<string, string>;
      expect(Object.keys(catalog).sort(), locale).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(catalog)) expect(uniq(v), `${locale} ${k}`).toBe(uniq(en[k]!));
    }
  });
});
