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
  constructor(private readonly i18n: II18nService) {}

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
      entries.map(async ({ locale, namespace }) => {
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
