/**
 * Loads locale catalog JSON files into an `I18nService` at app startup, and
 * (optionally) from a user-supplied directory at runtime.
 *
 * Two load paths:
 *
 *  1. **Built-in catalogs** ship with the app at `apps/desktop/locales/`.
 *     The renderer asks the main process to enumerate them via the
 *     `i18n:listBuiltinCatalogs` IPC and read the file contents via
 *     `i18n:readCatalog`. The main process knows the on-disk path (which
 *     differs between dev mode and a packaged asarUnpack'd app).
 *
 *  2. **User catalogs** live in `app.getPath('userData')/locales/`. They are
 *     scanned the same way and merged on top of the built-ins, so a user can
 *     override or add languages without touching the install directory.
 *
 * The IPC bridge is intentionally minimal - main process exposes the two
 * methods on `window.electron.i18n`, declared in `electron/preload.ts`. If the
 * bridge is unavailable (e.g. in unit tests), `loadAll()` resolves with an
 * empty result and the service falls back to whatever was preloaded
 * synchronously by tests.
 */

import type { II18nService, LocaleCode } from './II18nService';

export interface CatalogFile {
  locale: LocaleCode;
  namespace: string;
  strings: Record<string, string>;
}

export interface LocaleCatalogBridge {
  listBuiltinCatalogs(): Promise<Array<{ locale: LocaleCode; namespace: string }>>;
  readBuiltinCatalog(locale: LocaleCode, namespace: string): Promise<Record<string, string>>;
  listUserCatalogs(): Promise<Array<{ locale: LocaleCode; namespace: string }>>;
  readUserCatalog(locale: LocaleCode, namespace: string): Promise<Record<string, string>>;
}

/**
 * The bridge is exposed by `electron/preload.ts` on `window.electron.i18n`.
 * The `ElectronAPI` declaration there does not yet include
 * `i18n: LocaleCatalogBridge`, so we read it via an untyped lookup rather
 * than depending on that augmentation.
 */
function getBridge(): LocaleCatalogBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const electron = (window as unknown as { electron?: { i18n?: LocaleCatalogBridge } }).electron;
  return electron?.i18n;
}

export class LocaleCatalogLoader {
  /** Module namespaces (task 0113): skipped by `loadAll`, read on demand by `loadNamespace`. */
  private readonly lazyNamespaces = new Set<string>();

  constructor(private readonly i18n: II18nService) {
    // The service asks us for namespace files; it works the same when no bridge exists (resolves undefined).
    i18n.setNamespaceSource?.((locale, namespace) => this.readNamespace(locale, namespace));
  }

  /**
   * Mark a namespace as module-owned: `loadAll` no longer reads `<locale>/<namespace>.json`
   * eagerly, it loads on first use or module activation. Call before `loadAll`.
   */
  registerLazyNamespace(namespace: string): void {
    this.lazyNamespaces.add(namespace);
    this.i18n.registerNamespace?.(namespace);
  }

  /** Load a namespace's catalogs (current locale and `en`). A no-op for unknown or missing files; never throws. */
  async loadNamespace(namespace: string): Promise<void> {
    try {
      await this.i18n.loadNamespace(namespace);
    } catch {
      // never throws
    }
  }

  /** Built-in file first, the user's file merged over it. `undefined` when neither exists. */
  private async readNamespace(locale: LocaleCode, namespace: string): Promise<Record<string, string> | undefined> {
    const bridge = getBridge();
    if (!bridge) return undefined;
    let merged: Record<string, string> | undefined;
    const attempt = async (list: typeof bridge.listBuiltinCatalogs, read: typeof bridge.readBuiltinCatalog) => {
      try {
        const entries = await list();
        if (!entries.some((e) => e.locale === locale && e.namespace === namespace)) return;
        merged = { ...(merged ?? {}), ...(await read(locale, namespace)) };
      } catch {
        // missing or unreadable file: nothing to merge
      }
    };
    await attempt(bridge.listBuiltinCatalogs.bind(bridge), bridge.readBuiltinCatalog.bind(bridge));
    await attempt(bridge.listUserCatalogs.bind(bridge), bridge.readUserCatalog.bind(bridge));
    return merged;
  }

  async loadAll(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) return;
    await this.loadFrom(bridge.listBuiltinCatalogs.bind(bridge), bridge.readBuiltinCatalog.bind(bridge));
    await this.loadFrom(bridge.listUserCatalogs.bind(bridge), bridge.readUserCatalog.bind(bridge));
  }

  private async loadFrom(
    list: () => Promise<Array<{ locale: LocaleCode; namespace: string }>>,
    read: (locale: LocaleCode, namespace: string) => Promise<Record<string, string>>,
  ): Promise<void> {
    let entries: Array<{ locale: LocaleCode; namespace: string }> = [];
    try {
      entries = await list();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[i18n] failed to list catalogs:', err);
      return;
    }
    await Promise.all(
      entries
        .filter(({ namespace }) => !this.lazyNamespaces.has(namespace))
        .map(async ({ locale, namespace }) => {
        try {
          const strings = await read(locale, namespace);
          this.i18n.loadCatalog(locale, namespace, strings);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[i18n] failed to load ${locale}/${namespace}:`, err);
        }
      }),
    );
  }
}
