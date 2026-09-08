/**
 * IPC handlers exposing locale catalogs to the renderer's `LocaleCatalogLoader`.
 *
 * Two source directories are scanned:
 *
 *   1. **Built-in catalogs** ship with the application bundle. In dev mode
 *      they sit at `<repo>/apps/desktop/locales/`. In a packaged app the
 *      `locales/` directory is `asarUnpack`'d (see electron-builder.yml) and
 *      lives next to the asar archive at `process.resourcesPath/locales/`.
 *
 *   2. **User catalogs** live under `app.getPath('userData')/locales/`. They
 *      are merged on top of the built-ins, so a user (or extension) can drop
 *      a new language file in without touching the install directory.
 *
 * Catalog files are flat JSON keyed by namespace:
 *   `<root>/<bcp47>/<namespace>.json`  ->  loaded as `(locale, namespace, strings)`.
 *
 * The renderer reads them through `window.electron.i18n.{listBuiltinCatalogs,
 * readBuiltinCatalog, listUserCatalogs, readUserCatalog}` (see preload.ts).
 */

import type { IpcMain } from 'electron';
import { setMainLocale } from '../services/MainI18n';
import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';

interface CatalogEntry {
  locale: string;
  namespace: string;
}

function builtinLocalesDir(): string {
  // In dev (electron-vite), __dirname points at apps/desktop/out/main.
  // In a packaged build, asarUnpack moves locales/ to resourcesPath/locales.
  const dev = path.resolve(__dirname, '..', '..', 'locales');
  const packaged = path.join(process.resourcesPath ?? '', 'locales');
  return app.isPackaged ? packaged : dev;
}

function userLocalesDir(): string {
  return path.join(app.getPath('userData'), 'locales');
}

async function listCatalogs(root: string): Promise<CatalogEntry[]> {
  const out: CatalogEntry[] = [];
  let locales: string[];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    locales = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return out;
  }
  for (const locale of locales) {
    let files: string[];
    try {
      files = await fs.readdir(path.join(root, locale));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      out.push({ locale, namespace: file.replace(/\.json$/, '') });
    }
  }
  return out;
}

async function readCatalog(
  root: string,
  locale: string,
  namespace: string,
): Promise<Record<string, string>> {
  // Reject path traversal attempts so a malicious extension can't read
  // arbitrary files via the bridge.
  if (!/^[a-zA-Z0-9_-]+$/.test(locale) || !/^[a-zA-Z0-9_-]+$/.test(namespace)) {
    throw new Error(`invalid locale or namespace: ${locale}/${namespace}`);
  }
  const file = path.join(root, locale, `${namespace}.json`);
  const text = await fs.readFile(file, 'utf8');
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`catalog ${file} is not a JSON object`);
  }
  return parsed as Record<string, string>;
}

export function registerI18nHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('i18n:listBuiltinCatalogs', () => listCatalogs(builtinLocalesDir()));
  ipcMain.handle('i18n:readBuiltinCatalog', (_event, locale: string, namespace: string) =>
    readCatalog(builtinLocalesDir(), locale, namespace),
  );
  ipcMain.handle('i18n:listUserCatalogs', () => listCatalogs(userLocalesDir()));
  ipcMain.handle('i18n:readUserCatalog', (_event, locale: string, namespace: string) =>
    readCatalog(userLocalesDir(), locale, namespace),
  );
  // The locale is chosen and persisted in the renderer, but main needs it too:
  // menus, native dialogs and window titles are built here.
  ipcMain.handle('i18n:setLocale', (_event, locale: string) => {
    setMainLocale(locale);
  });
}
