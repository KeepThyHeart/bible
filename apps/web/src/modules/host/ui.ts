/**
 * The web app's own UI declarations as one built-in feature module (task 0113,
 * phase 1): the home-screen tiles and the settings panel's tabs, exactly as
 * they were hard-coded. Phase 2 can split these into per-feature modules; ids
 * and order stay. Data only: no imports of component code (entry-chunk safe).
 *
 * Tile targets: `{ panelType: 'search' }` is a right-pane mode id on web;
 * `{ commandId }` names a home-screen command HomeScreen knows how to run.
 * The Presenter's "Watch a presentation" tile (order 30) comes from its own module.
 */
import type { FeatureModuleManifest, NewTabTileContribution, PreferencesSectionContribution } from '@bible/core/browser';

const icon = (name: string) => ({ kind: 'builtin', name }) as const;

export const HOME_TILES: readonly NewTabTileContribution[] = [
  {
    id: 'readBible',
    title: { key: 'homeScreen.readBible', fallback: 'Read Bible' },
    icon: icon('fa-book-open'),
    order: 10,
    target: { commandId: 'home.readBible' },
  },
  {
    id: 'search',
    title: { key: 'homeScreen.search', fallback: 'Search' },
    icon: icon('fa-magnifying-glass'),
    order: 20,
    target: { panelType: 'search' },
  },

];

/** Settings panel tabs in today's order. The `title.key` is the tab label's catalog key. */
export const SETTINGS_SECTIONS: readonly PreferencesSectionContribution[] = [
  { id: 'text-size', title: { key: 'settings.tabs.textSize', fallback: 'Text Size' }, icon: icon('fa-text-height'), order: 10 },
  { id: 'theme', title: { key: 'settings.tabs.theme', fallback: 'Theme' }, icon: icon('fa-palette'), order: 20 },
  { id: 'modules', title: { key: 'settings.tabs.modules', fallback: 'Modules' }, icon: icon('fa-book'), order: 30 },
  { id: 'gestures', title: { key: 'settings.tabs.gestures', fallback: 'Gestures' }, icon: icon('fa-hand-pointer'), order: 40, settingsGroup: 'gestures' },
  { id: 'apps', title: { key: 'settings.apps.title', fallback: 'Apps' }, icon: icon('fa-table-cells-large'), order: 80 },
  { id: 'about', title: { key: 'settings.tabs.about', fallback: 'About' }, icon: icon('fa-circle-info'), order: 90 },
];

export const hostUiManifest: FeatureModuleManifest = {
  id: 'host-ui',
  platforms: ['web'],
  contributes: {
    newTabTiles: [...HOME_TILES],
    preferencesSections: [...SETTINGS_SECTIONS],
  },
};
