import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ReferenceEngine } from '../engine';
import { loadReferenceLocales } from '../registry';
import type { EngineParseOptions } from '../types';
import { LOCALE_TAGS, encodeParse } from './helpers';

interface ParseCase {
  in: string;
  out: string | null;
  opts?: EngineParseOptions;
}
interface ScanCase {
  in: string;
  found: string[];
}
interface Cases {
  parse: ParseCase[];
  scan: ScanCase[];
}

const dir = path.join(__dirname, '..', 'locales');

describe('golden cases', () => {
  beforeAll(async () => {
    await loadReferenceLocales([...LOCALE_TAGS]);
  });

  for (const tag of LOCALE_TAGS) {
    const file = path.join(dir, `${tag}.cases.json`);
    const cases = JSON.parse(fs.readFileSync(file, 'utf8')) as Cases;

    describe(tag, () => {
      it('has a healthy number of cases', () => {
        expect(cases.parse.length).toBeGreaterThanOrEqual(15);
        expect(cases.scan.length).toBeGreaterThanOrEqual(3);
      });

      describe('parse', () => {
        for (const c of cases.parse) {
          it(`${JSON.stringify(c.in)} -> ${c.out}${c.opts ? ' ' + JSON.stringify(c.opts) : ''}`, () => {
            const engine = ReferenceEngine.create({ locales: [tag, 'en'] });
            expect(encodeParse(engine.parse(c.in, c.opts))).toBe(c.out);
          });
        }
      });

      describe('scan', () => {
        for (const c of cases.scan) {
          it(`${JSON.stringify(c.in)}`, () => {
            const engine = ReferenceEngine.create({ locales: [tag, 'en'] });
            expect(engine.scan(c.in).map((m) => m.text)).toEqual(c.found);
          });
        }
      });
    });
  }
});
