import { describe, it, expect, beforeEach } from 'vitest';
import { I18nService } from '../services/I18nService';
import {
  applyDocumentDirection,
  bindDocumentDirection,
  readStoredLocale,
  writeStoredLocale,
  restorePersistedLocale,
  LOCALE_STORAGE_KEY,
} from './documentDirection';

function serviceWithLocales(): I18nService {
  const i18n = new I18nService();
  i18n.loadCatalog('en', 'meta', {
    'locale.name': 'English',
    'locale.nativeName': 'English',
    'locale.status': 'complete',
    'locale.direction': 'ltr',
  });
  i18n.loadCatalog('ar', 'meta', {
    'locale.name': 'Arabic',
    'locale.nativeName': 'العربية',
    'locale.status': 'draft',
    'locale.direction': 'rtl',
  });
  return i18n;
}

describe('documentDirection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
  });

  it('applies dir and lang from the active locale', () => {
    const i18n = serviceWithLocales();
    applyDocumentDirection(i18n);
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('re-applies on locale change once bound', async () => {
    const i18n = serviceWithLocales();
    bindDocumentDirection(i18n);
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');

    await i18n.setLocale('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');

    await i18n.setLocale('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('stops updating after the binding is disposed', async () => {
    const i18n = serviceWithLocales();
    const dispose = bindDocumentDirection(i18n);
    dispose();
    await i18n.setLocale('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('round-trips the locale through localStorage', () => {
    expect(readStoredLocale()).toBeUndefined();
    writeStoredLocale('ar');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ar');
    expect(readStoredLocale()).toBe('ar');
  });

  it('restores a persisted locale and keeps persisting later changes', async () => {
    writeStoredLocale('ar');
    const i18n = serviceWithLocales();
    bindDocumentDirection(i18n);
    restorePersistedLocale(i18n);

    // setLocale is async; let the microtask queue drain.
    await Promise.resolve();
    expect(i18n.currentLocale).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    await i18n.setLocale('en');
    expect(readStoredLocale()).toBe('en');
  });

  it('leaves the locale alone when nothing is persisted', () => {
    const i18n = serviceWithLocales();
    restorePersistedLocale(i18n);
    expect(i18n.currentLocale).toBe('en');
  });
});
