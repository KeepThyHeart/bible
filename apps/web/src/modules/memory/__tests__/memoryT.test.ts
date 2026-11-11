import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMemoryTranslator, translatorFor } from '../memoryT';

const desktopCatalog = (locale: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../../desktop/locales/${locale}/memory.json`), 'utf8')) as Record<string, string>;

describe('the web Memory translator', () => {
  it('formats the English fallback with ICU params when the catalog has no key', () => {
    const t = translatorFor({}, 'en');
    expect(t('memory.x', '{count, plural, one {# verse} other {# verses}}', { count: 2 })).toBe('2 verses');
  });

  it('prefers the catalog text', () => {
    const t = translatorFor({ 'memory.x': 'Hola {name}' }, 'es');
    expect(t('memory.x', 'Hello {name}', { name: 'Ana' })).toBe('Hola Ana');
  });

  it('loads the shared desktop catalog for a translated locale', async () => {
    const es = desktopCatalog('es');
    const [key, text] = Object.entries(es).find(([, v]) => !v.includes('{'))!;
    const t = await loadMemoryTranslator('es');
    expect(t(key, 'English fallback')).toBe(text);
  });

  it('English and unknown locales fall back to the code text', async () => {
    expect((await loadMemoryTranslator('en'))('memory.nope', 'Fallback')).toBe('Fallback');
    expect((await loadMemoryTranslator('tlh'))('memory.nope', 'Fallback')).toBe('Fallback');
  });
});
