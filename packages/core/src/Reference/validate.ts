/**
 * Locale data validator: what CI checks for every file in `./locales/`.
 * Errors fail the build; warnings (cross-locale clashes) are a report.
 */
import { compileLocale, type CompiledLocale } from './compile';
import type { ReferenceLocaleData } from './types';

export interface LocaleValidationReport {
  tag: string;
  errors: string[];
  warnings: string[];
}

const STATUSES = new Set(['draft', 'beta', 'complete']);

/** Check one locale's merged data (inheritance applied). */
export function validateReferenceLocale(data: ReferenceLocaleData): LocaleValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!data.tag || typeof data.tag !== 'string') errors.push('missing "tag"');
  if (data.status && !STATUSES.has(data.status)) errors.push(`unknown status "${data.status}"`);
  const books = data.books ?? {};
  for (const k of Object.keys(books)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > 66) errors.push(`book key "${k}" is not 1..66`);
  }
  for (let n = 1; n <= 66; n++) {
    const b = books[String(n)];
    if (!b?.long) errors.push(`book ${n} has no "long" name`);
  }
  for (const [k, v] of Object.entries(data.ambiguous ?? {})) {
    const all = [v.prefer, ...(v.also ?? [])];
    if (all.some((n) => !Number.isInteger(n) || n < 1 || n > 66)) errors.push(`ambiguous "${k}" points at a book outside 1..66`);
  }
  for (const [k, words] of Object.entries(data.ordinals ?? {})) {
    if (!['1', '2', '3'].includes(k)) errors.push(`ordinal key "${k}" must be 1, 2 or 3`);
    if (!Array.isArray(words)) errors.push(`ordinals["${k}"] must be a list`);
  }
  for (const [key, list] of Object.entries(data.syntax ?? {})) {
    if (!Array.isArray(list) || list.some((x) => typeof x !== 'string' || !x)) errors.push(`syntax.${key} must be a list of non-empty strings`);
  }
  let compiled: CompiledLocale | undefined;
  try {
    compiled = compileLocale(data);
  } catch (e) {
    errors.push(`does not compile: ${(e as Error).message}`);
  }
  for (const c of compiled?.clashes ?? []) {
    errors.push(`"${c.name}" names books ${c.books.join(' and ')}; list it under "ambiguous" or drop one`);
  }
  const cv = compiled?.syntax.chapterVerse ?? [];
  const list = compiled?.syntax.list ?? [];
  for (const sep of cv) if (sep !== ',' && list.includes(sep)) errors.push(`"${sep}" is both a chapter:verse and a list separator`);
  return { tag: data.tag, errors, warnings };
}

/** Folded strings two locales map to different books (a warning: priority order resolves them). */
export function crossLocaleClashes(locales: readonly CompiledLocale[]): Array<{ name: string; a: string; b: string; books: [number, number] }> {
  const out: Array<{ name: string; a: string; b: string; books: [number, number] }> = [];
  for (let i = 0; i < locales.length; i++) {
    for (let j = i + 1; j < locales.length; j++) {
      const A = locales[i];
      const B = locales[j];
      for (const [name, t] of A.names) {
        const u = B.names.get(name);
        if (u && u.book !== t.book && t.explicit && u.explicit) out.push({ name, a: A.tag, b: B.tag, books: [t.book, u.book] });
      }
    }
  }
  return out;
}
