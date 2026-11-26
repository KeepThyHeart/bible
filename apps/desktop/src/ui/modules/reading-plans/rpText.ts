/**
 * Small text helpers for the reading-plan code that has no component to call `useI18n` from (badge, commands):
 * catalog lookup with the English written beside the call, and a plain "Genesis 4-6" for a reading.
 */
import { getBookName, ReadingPlans } from '@bible/core/browser';
import { i18nService } from '../../services/I18nService';
import { bibleAPI } from '../../services/electronAPI';
import { getBookNameFromCache, loadBookNamesCache } from '../../utils/verseReference';

type T = (key: string, params?: Record<string, unknown>) => string;

/** Translate `key`; a missing entry gives `fallback` with `{name}` placeholders filled from `params`. */
export function rpTextWith(t: T, key: string, fallback: string, params: Record<string, unknown> = {}): string {
  const out = t(key, params);
  if (out !== `[${key}]` && out !== key) return out;
  return fallback.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function rpText(key: string, fallback: string, params: Record<string, unknown> = {}): string {
  return rpTextWith((k, p) => i18nService.t(k, p), key, fallback, params);
}

/** Warm the localized book-name cache (never throws). */
export async function ensureBookNames(): Promise<void> {
  try { await loadBookNamesCache(bibleAPI); } catch { /* English names are used */ }
}

/** "Genesis 4-6" in the active language (English names until the cache has loaded). */
export function formatReadingText(reading: ReadingPlans.Reading): string {
  return ReadingPlans.formatReading(reading, (book) => {
    const cached = getBookNameFromCache(book);
    return cached && cached !== 'Unknown' ? cached : getBookName(book);
  });
}
