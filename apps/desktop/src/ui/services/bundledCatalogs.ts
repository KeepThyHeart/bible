/**
 * The English catalogs bundled into every renderer as static JSON, so the first paint has real
 * strings. `loadCatalog()` fires no event, so a pane that renders before the async
 * `LocaleCatalogLoader.loadAll()` finishes would keep showing `[key]` for English forever.
 * Both renderer entries (main and the detached pane window) seed these synchronously.
 */
import type { II18nService } from './II18nService';
import enUi from '../../../locales/en/ui.json';
import enCommands from '../../../locales/en/commands.json';
import enLayout from '../../../locales/en/layout.json';
import enSearchBar from '../../../locales/en/searchBar.json';
import enMenu from '../../../locales/en/menu.json';

export function loadBundledEnglishCatalogs(i18n: Pick<II18nService, 'loadCatalog'>): void {
  i18n.loadCatalog('en', 'ui', enUi as Record<string, string>);
  i18n.loadCatalog('en', 'commands', enCommands as Record<string, string>);
  i18n.loadCatalog('en', 'layout', enLayout as Record<string, string>);
  i18n.loadCatalog('en', 'searchBar', enSearchBar as Record<string, string>);
  i18n.loadCatalog('en', 'menu', enMenu as Record<string, string>);
}
