/**
 * The kit's one piece of shared state: the locale and text direction the host reported through
 * `ui.getLocale` (or the page passed to `KthKit.init`). Connected kit elements subscribe and re-render when it
 * changes. The locale picks the book-name tables and collation (via the core Localizer); it does NOT translate
 * UI strings: labels are element attributes with English defaults, and authors localize them themselves.
 */
import { directionForTag, loadReferenceLocales } from '@bible/core/browser';

export interface KitLocale {
  locale: string;
  direction: 'ltr' | 'rtl';
}

/** A conservative BCP 47 shape: anything else falls back to English. */
const TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

let current: KitLocale = { locale: 'en', direction: 'ltr' };
const subs = new Set<() => void>();

export const getKitLocale = (): KitLocale => current;

/** Untrusted input (RPC result, page code) to a valid locale. */
export function sanitizeLocale(locale: unknown, direction?: unknown): KitLocale {
  const tag = typeof locale === 'string' && TAG.test(locale) ? locale : 'en';
  const dir = direction === 'rtl' || direction === 'ltr' ? direction : directionForTag(tag);
  return { locale: tag, direction: dir };
}

export function setKitLocale(next: KitLocale): void {
  if (next.locale === current.locale && next.direction === current.direction) return;
  current = next;
  subs.forEach((f) => f());
  // Reference data (book names) for the language loads on demand (task 0077); re-render once it is in.
  void ensureKitReferenceData().then((loaded) => {
    if (loaded.length && current === next) subs.forEach((f) => f());
  });
}

/** Load the reference-engine data for the kit's locale; resolves to the data tags loaded. */
export function ensureKitReferenceData(): Promise<string[]> {
  return loadReferenceLocales([current.locale]);
}

export function subscribeKitLocale(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
