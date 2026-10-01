import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compileLocale } from '../compile';
import { validateReferenceLocale, crossLocaleClashes } from '../validate';
import type { ReferenceLocaleData } from '../types';

const dir = path.join(__dirname, '..', 'locales');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json') && !f.endsWith('.cases.json'))
  .sort();

const data = new Map<string, ReferenceLocaleData>();
for (const f of files) data.set(f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ReferenceLocaleData);

describe('locale files', () => {
  it('finds the six shipped locales', () => {
    expect(files).toEqual(['ar.json', 'en.json', 'es.json', 'fa.json', 'he.json', 'zh-Hans.json']);
  });

  for (const f of files) {
    describe(f, () => {
      const d = data.get(f)!;
      it('file name matches its tag', () => {
        expect(f).toBe(`${d.tag}.json`);
      });
      it('validates without errors', () => {
        const report = validateReferenceLocale(d);
        expect(report.errors).toEqual([]);
      });
      it('has 66 books with long names', () => {
        const books = d.books ?? {};
        expect(Object.keys(books)).toHaveLength(66);
        for (let n = 1; n <= 66; n++) expect(books[String(n)]?.long, `book ${n}`).toBeTruthy();
      });
      it('has a status and direction', () => {
        expect(['draft', 'beta', 'complete']).toContain(d.status);
        expect(['ltr', 'rtl']).toContain(d.direction);
      });
    });
  }

  it('reports cross-locale clashes (informational)', () => {
    const compiled = [...data.values()].map((d) => compileLocale(d));
    const clashes = crossLocaleClashes(compiled);
    const lines = clashes.map((c) => `  "${c.name}": ${c.a} -> ${c.books[0]}, ${c.b} -> ${c.books[1]}`);
    console.info(`Cross-locale clashes (${clashes.length}):\n${lines.join('\n')}`);
    expect(Array.isArray(clashes)).toBe(true);
  });
});
