/**
 * Production `IExtensionL10nBridge`.
 *
 * Wraps the renderer-side `I18nService`. Each extension's
 * `l10n/<bcp47>.json` catalog is loaded under an `ext.<id>.` namespace at
 * activate time and dropped on deactivate; see `loadExtensionCatalog` /
 * `dropExtensionCatalog` for the host-side hook points called from
 * `ExtensionHost.activate` / `deactivate` once the extension manifest declares
 * an `l10n` directory.
 *
 * `t()` is synchronous on purpose - extensions consume i18n the same way the
 * built-in command titles do, so any IPC delay would surface as flickering
 * placeholders. The bridge maintains a write-through cache of every loaded
 * catalog so reads stay local.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ipcMain, type BrowserWindow } from 'electron';
import log from 'electron-log';

import type { IExtensionL10nBridge } from '../api-impl/IExtensionDataBridges';
import { BridgeRpc } from './RendererBridgeRpc';

interface CatalogEntry {
  /** Maps `<locale>::<key>` (key is *bare*, no `ext.<id>.` prefix) -> string. */
  catalogs: Map<string, string>;
}

export class RendererL10nBridge implements IExtensionL10nBridge {
  private readonly rpc: BridgeRpc;
  private readonly extensionCatalogs = new Map<string, CatalogEntry>();
  private locale = 'en';
  private readonly localeHandlers = new Set<(locale: string) => void>();

  constructor(getWindow: () => BrowserWindow | null) {
    this.rpc = new BridgeRpc({
      outboundChannel: 'ext-bridge:l10n',
      responseChannel: 'ext-bridge:l10n:response',
      getWindow,
    });

    // Renderer pushes locale changes here so the bridge can fan them out to
    // every subscribed extension worker. The boot snapshot also lands on
    // this channel with `{ snapshot: 'en' }`.
    ipcMain.on('ext-bridge:l10n:sync', (_event, payload: { locale?: string }) => {
      if (payload.locale && payload.locale !== this.locale) {
        this.locale = payload.locale;
        for (const h of this.localeHandlers) {
          try { h(this.locale); } catch { /* swallow */ }
        }
      }
    });
  }

  // --- IExtensionL10nBridge --------------------------------------------

  t(extensionId: string, key: string, params?: Record<string, unknown>): string {
    const entry = this.extensionCatalogs.get(extensionId);
    if (!entry) return `[ext.${extensionId}.${key}]`;
    const lookup = (loc: string): string | undefined => entry.catalogs.get(`${loc}::${key}`);
    const template = lookup(this.locale) ?? lookup('en') ?? `[ext.${extensionId}.${key}]`;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => {
      const v = params[name];
      return v !== undefined ? String(v) : `{${name}}`;
    });
  }

  currentLocale(): string {
    return this.locale;
  }

  subscribeLocaleChange(handler: (locale: string) => void): () => void {
    this.localeHandlers.add(handler);
    return () => { this.localeHandlers.delete(handler); };
  }

  // --- Host-side hooks (called from ExtensionHost) ---------------------

  /**
   * Walk `<installPath>/l10n/` and load every `<bcp47>.json` catalog under
   * the extension's namespace. The renderer is also told so its own
   * `I18nService` picks up the strings (so any future renderer-side display
   * of an extension-contributed string Just Works).
   */
  loadExtensionCatalog(extensionId: string, installPath: string): void {
    const dir = join(installPath, 'l10n');
    if (!existsSync(dir)) return;
    const entry: CatalogEntry = { catalogs: new Map() };
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch (err) {
      log.warn(`[L10nBridge] could not read l10n dir for ${extensionId}:`, err);
      return;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const locale = file.slice(0, -'.json'.length);
      try {
        const raw = readFileSync(join(dir, file), 'utf8');
        const parsed = JSON.parse(raw) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') entry.catalogs.set(`${locale}::${k}`, v);
        }
        // Push the catalog into the renderer's I18nService too. Best-effort.
        this.rpc.notify('loadCatalog', [
          { extensionId, locale, strings: parsed },
        ]);
      } catch (err) {
        log.warn(`[L10nBridge] could not parse ${file} for ${extensionId}:`, err);
      }
    }
    this.extensionCatalogs.set(extensionId, entry);
  }

  /** Drop every catalog owned by `extensionId`. Idempotent. */
  dropExtensionCatalog(extensionId: string): void {
    if (this.extensionCatalogs.delete(extensionId)) {
      this.rpc.notify('dropCatalog', [{ extensionId }]);
    }
  }
}
