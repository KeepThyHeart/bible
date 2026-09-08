/**
 * Default `II18nService` implementation. Holds a per-locale flat key->string
 * map merged from all loaded catalog namespaces.
 *
 * ICU MessageFormat is intentionally lazy-loaded: the bundle pulls in
 * `@formatjs/intl-messageformat` only the first time a string with `params`
 * is rendered. Most UI strings have no params and never touch ICU.
 *
 * Persistence of the active locale is delegated to a small adapter callback so
 * this file has no direct dependency on Zustand or the user DB.
 */

import { Emitter } from '../types/Event';
import type { IEvent } from '../types/Event';
import type {
  II18nService,
  LocaleCode,
  LocaleDirection,
  LocaleMetadata,
  LocaleStatus,
} from './II18nService';
import type { LocalizedString } from '../types/LocalizedString';
import { isLocalizedKey } from '../types/LocalizedString';

const FALLBACK_LOCALE: LocaleCode = 'en';

/**
 * Catalog keys that carry locale metadata. They live in the locale's
 * `meta.json` namespace so the existing catalog bridge loads them with no
 * special-casing; the `locale.` prefix keeps them out of the way of real UI
 * keys.
 */
const META_KEY_NAME = 'locale.name';
const META_KEY_NATIVE_NAME = 'locale.nativeName';
const META_KEY_STATUS = 'locale.status';
const META_KEY_DIRECTION = 'locale.direction';

/**
 * Applied when a locale ships no `meta.json` (for example, a folder a user
 * dropped into their `userData/locales/` directory). Unknown provenance is
 * deliberately reported as `draft` - we would rather understate quality than
 * imply a review that never happened.
 */
const DEFAULT_LOCALE_STATUS: LocaleStatus = 'draft';
const DEFAULT_LOCALE_DIRECTION: LocaleDirection = 'ltr';
const isDev =
  typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';

type Catalog = Record<string, string>;

export interface I18nServiceOptions {
  /** Initial locale (defaults to 'en'). */
  initialLocale?: LocaleCode;
  /** Optional persistence hook called whenever the locale changes. */
  persistLocale?: (locale: LocaleCode) => Promise<void> | void;
}

// Lazy ICU formatter loader. We avoid a static import so unit tests and
// no-param call sites don't pay the cost.
/**
 * `format()` is deliberately typed as returning `string | unknown[]`, which is
 * what `intl-messageformat` actually does: it yields an **array** whenever any
 * argument is not a primitive, so the parts can be spliced together by the
 * caller. Typing this as plain `string` would silently defeat type-checking
 * and let a non-string escape into code that calls string methods on it.
 * Keep it honest - `formatWithIcu` narrows it.
 */
type IcuFormatter = { format(values?: Record<string, unknown>): string | unknown[] };

type IntlMessageFormatCtor = new (
  message: string,
  locales?: string | string[],
) => IcuFormatter;

let icuLoader: Promise<IntlMessageFormatCtor | null> | null = null;
function loadIcu(): Promise<IntlMessageFormatCtor | null> {
  if (icuLoader) return icuLoader;
  icuLoader = import('intl-messageformat')
    .then((mod) => (mod as unknown as { IntlMessageFormat: IntlMessageFormatCtor }).IntlMessageFormat)
    .catch(() => null);
  return icuLoader;
}

export class I18nService implements II18nService {
  /** locale -> merged flat catalog */
  private readonly catalogs: Map<LocaleCode, Catalog> = new Map();
  private locale: LocaleCode;
  private readonly emitter = new Emitter<LocaleCode>();
  private readonly missingWarned = new Set<string>();
  private readonly persistLocale?: (locale: LocaleCode) => Promise<void> | void;
  /** Cached ICU formatters keyed by `${locale}::${message}`. */
  private readonly formatterCache: Map<string, IcuFormatter> = new Map();
  private icuCtor: IntlMessageFormatCtor | null = null;

  readonly onDidChangeLocale: IEvent<LocaleCode> = this.emitter.event;

  constructor(opts: I18nServiceOptions = {}) {
    this.locale = opts.initialLocale ?? FALLBACK_LOCALE;
    if (opts.persistLocale) {
      this.persistLocale = opts.persistLocale;
    }
    // Always make sure the fallback catalog exists, even if empty.
    if (!this.catalogs.has(FALLBACK_LOCALE)) {
      this.catalogs.set(FALLBACK_LOCALE, {});
    }
  }

  get currentLocale(): LocaleCode {
    return this.locale;
  }

  get availableLocales(): LocaleCode[] {
    return Array.from(this.catalogs.keys());
  }

  get availableLocaleInfos(): LocaleMetadata[] {
    const infos = Array.from(this.catalogs.keys()).map((code) => this.getLocaleMetadata(code));
    // Fallback locale first, then complete before draft, then by native name.
    return infos.sort((a, b) => {
      if (a.code !== b.code) {
        if (a.code === FALLBACK_LOCALE) return -1;
        if (b.code === FALLBACK_LOCALE) return 1;
      }
      if (a.status !== b.status) return a.status === 'complete' ? -1 : 1;
      return a.nativeName.localeCompare(b.nativeName);
    });
  }

  getLocaleMetadata(locale: LocaleCode): LocaleMetadata {
    // Read from the locale's OWN catalog only - never through the en fallback,
    // or every locale would claim to be English and `complete`.
    const cat = this.catalogs.get(locale);
    const read = (key: string): string | undefined => {
      const v = cat?.[key];
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    };
    const status = read(META_KEY_STATUS);
    const direction = read(META_KEY_DIRECTION);
    return {
      code: locale,
      name: read(META_KEY_NAME) ?? locale,
      nativeName: read(META_KEY_NATIVE_NAME) ?? read(META_KEY_NAME) ?? locale,
      status: status === 'complete' || status === 'draft' ? status : DEFAULT_LOCALE_STATUS,
      direction: direction === 'ltr' || direction === 'rtl' ? direction : DEFAULT_LOCALE_DIRECTION,
    };
  }

  get currentDirection(): LocaleDirection {
    return this.getLocaleMetadata(this.locale).direction;
  }

  loadCatalog(locale: LocaleCode, namespace: string, strings: Record<string, string>): void {
    let cat = this.catalogs.get(locale);
    if (!cat) {
      cat = {};
      this.catalogs.set(locale, cat);
    }
    // Namespaces are flat: keys may already be `${namespace}.foo`, or callers
    // may pass already-namespaced keys. We trust the catalog file format.
    // The `namespace` argument is reserved for future debugging/inspection.
    void namespace;
    Object.assign(cat, strings);
    // Drop any cached formatters for this locale because their messages may
    // have changed.
    for (const k of Array.from(this.formatterCache.keys())) {
      if (k.startsWith(`${locale}::`)) this.formatterCache.delete(k);
    }
  }

  t(key: string, params?: Record<string, unknown>): string {
    const message = this.lookup(key);
    if (message === undefined) {
      this.warnMissing(key);
      return `[${key}]`;
    }
    if (!params) return message;
    return this.formatWithIcu(message, this.resolveParams(params));
  }

  /**
   * Resolve any parameter that is itself a catalog reference into a plain
   * string before it reaches ICU.
   *
   * Callers legitimately nest one localized value inside another - a layout
   * command's title is `layout.applyPreset.title` ("Apply {presetName}") whose
   * `presetName` is itself the key `layout.studyMode.name`. Passing that object
   * through unresolved is not merely cosmetic: `intl-messageformat` returns an
   * **array** rather than a string whenever an argument is not a primitive, and
   * that array then flowed out of `formatWithIcu` (declared `: string`) into
   * `CommandRegistry.query`, where `.toLowerCase()` on it killed the renderer.
   *
   * Resolution recurses naturally, since `resolve()` calls back into `t()`.
   * The params object is only copied when something actually needs resolving.
   */
  private resolveParams(params: Record<string, unknown>): Record<string, unknown> {
    let resolved: Record<string, unknown> | undefined;
    for (const name of Object.keys(params)) {
      const value = params[name];
      if (isLocalizedKey(value)) {
        resolved ??= { ...params };
        resolved[name] = this.resolve(value);
      }
    }
    return resolved ?? params;
  }

  resolve(value: LocalizedString): string {
    if (typeof value === 'string') return value;
    if (isLocalizedKey(value)) return this.t(value.key, value.params);
    return String(value);
  }

  tAliases(key: string): string[] {
    const out: string[] = [];
    for (let i = 0; ; i++) {
      const v = this.lookup(`${key}.alias.${i}`);
      if (v === undefined) break;
      out.push(v);
    }
    return out;
  }

  async setLocale(locale: LocaleCode): Promise<void> {
    if (locale === this.locale) return;
    if (!this.catalogs.has(locale)) {
      // We allow switching to a locale that has no catalog yet - every key
      // will fall back to en. This matches the "drop a JSON file and switch"
      // workflow during translation work.
      this.catalogs.set(locale, {});
    }
    this.locale = locale;
    if (this.persistLocale) {
      try {
        await this.persistLocale(locale);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[i18n] failed to persist locale:', err);
      }
    }
    this.emitter.fire(locale);
  }

  private lookup(key: string): string | undefined {
    const primary = this.catalogs.get(this.locale);
    if (primary && Object.prototype.hasOwnProperty.call(primary, key)) {
      return primary[key];
    }
    if (this.locale !== FALLBACK_LOCALE) {
      const fb = this.catalogs.get(FALLBACK_LOCALE);
      if (fb && Object.prototype.hasOwnProperty.call(fb, key)) {
        return fb[key];
      }
    }
    return undefined;
  }

  private warnMissing(key: string): void {
    if (!isDev) return;
    if (this.missingWarned.has(key)) return;
    this.missingWarned.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing translation key: ${key} (locale=${this.locale})`);
  }

  private formatWithIcu(message: string, params: Record<string, unknown>): string {
    // Fast path: no ICU syntax in the string. Cheap heuristic - `{` indicates
    // ICU placeholders. If absent, just return the message verbatim.
    if (message.indexOf('{') === -1) return message;

    const cacheKey = `${this.locale}::${message}`;
    let formatter = this.formatterCache.get(cacheKey);
    if (!formatter) {
      if (!this.icuCtor) {
        // First call - kick off lazy load. Until ICU resolves, fall back to
        // a naive `{name}` substitution so the UI isn't blank.
        void loadIcu().then((ctor) => {
          if (ctor) this.icuCtor = ctor;
        });
        return naiveFormat(message, params);
      }
      try {
        formatter = new this.icuCtor(message, this.locale);
        this.formatterCache.set(cacheKey, formatter);
      } catch (err) {
        if (isDev) {
          // eslint-disable-next-line no-console
          console.warn(`[i18n] ICU parse failed for ${JSON.stringify(message)}:`, (err as Error).message);
        }
        return naiveFormat(message, params);
      }
    }
    try {
      const formatted = formatter.format(params);
      if (typeof formatted === 'string') return formatted;
      // Belt-and-braces. `resolveParams` should have turned every non-primitive
      // argument into a string already, so reaching here means a caller passed
      // something we don't know how to localize. Flattening keeps the UI
      // readable and - critically - keeps this method's contract of returning a
      // string, rather than handing an array to code that will call
      // `.toLowerCase()` on it and take the renderer down.
      return formatted.map((part) => (typeof part === 'string' ? part : String(part))).join('');
    } catch {
      return naiveFormat(message, params);
    }
  }
}

function naiveFormat(message: string, params: Record<string, unknown>): string {
  return message.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : `{${k}}`,
  );
}

/** Singleton instance - same convention as the other services. */
export const i18nService = new I18nService();
