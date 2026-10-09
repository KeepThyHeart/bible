/**
 * The desktop's own new-tab tiles and preferences sections, declared as
 * contributions (task 0113, phase 1). Manifest id `host-ui`; the panel types
 * live in the sibling `host` manifest (`panels.ts`).
 *
 * Phase 1 changes nothing a user sees: ids, titles, icons, order and keywords
 * are exactly what `NewTabPage` and `PreferencesDialog` hard-coded before.
 * One array entry per item, so phase 2 can move an entry into its feature's
 * own manifest unchanged.
 *
 * Preferences section components load through `views['preferences:<id>']`
 * (lazy, nothing imported at boot). Orders are in the built-in band (0-99) and
 * spaced by 5 so a module can slot in between.
 */
import type {
  FeatureModuleBinding,
  FeatureModuleManifest,
  NewTabTileContribution,
  PreferencesSectionContribution,
} from '@bible/core/browser';

const tile = (
  order: number,
  panelType: string,
  titleKey: string,
  fallback: string,
  keywords: readonly string[],
): NewTabTileContribution => ({
  id: panelType,
  title: { key: titleKey, fallback },
  icon: { kind: 'builtin', name: panelType },
  order,
  target: { panelType },
  keywords,
});

/**
 * Row 1 is where a new pane usually goes: Scripture, then the two places the
 * user writes. Row 2 is the study apparatus that hangs off a verse. Array order
 * is row order (four tiles per row).
 */
export const HOST_NEW_TAB_TILES: readonly NewTabTileContribution[] = [
  tile(5, 'bible', 'newTabPage.type.bible', 'Bible', ['bible']),
  tile(10, 'notes', 'newTabPage.type.notes', 'Notes', ['notes', 'note']),
  tile(15, 'prayer', 'newTabPage.type.prayer', 'Prayer', ['prayer']),
  tile(20, 'book', 'newTabPage.type.book', 'Books', ['books', 'book']),
  tile(25, 'study', 'newTabPage.type.study', 'Study', ['study']),
  tile(30, 'commentary', 'newTabPage.type.commentary', 'Commentary', ['commentary', 'comm']),
  tile(35, 'dictionary', 'newTabPage.type.dictionary', 'Dictionary', ['dictionary', 'dict']),
  tile(40, 'topics', 'newTabPage.type.topics', 'Topics', ['topics', 'topic']),
];

const section = (order: number, id: string, titleKey: string, fallback: string): PreferencesSectionContribution => ({
  id,
  title: { key: titleKey, fallback },
  icon: { kind: 'builtin', name: id },
  order,
});

export const HOST_PREFERENCES_SECTIONS: readonly PreferencesSectionContribution[] = [
  section(5, 'general', 'preferencesDialog.sectionGeneral', 'General'),
  section(10, 'typography', 'preferencesDialog.sectionTypography', 'Typography'),
  section(15, 'fonts', 'preferencesDialog.sectionFonts', 'Fonts'),
  section(20, 'themes', 'preferencesDialog.sectionThemes', 'Themes'),
  section(25, 'privacy', 'preferencesDialog.sectionPrivacy', 'Privacy'),
  section(40, 'extensions', 'preferencesDialog.sectionExtensions', 'Extensions'),
  section(45, 'apps', 'preferencesDialog.sectionApps', 'Apps'),
  section(55, 'advanced', 'preferencesDialog.sectionAdvanced', 'Advanced'),
  section(60, 'diagnostics', 'preferencesDialog.sectionDiagnostics', 'Diagnostics'),
];

export const hostUiManifest: FeatureModuleManifest = {
  id: 'host-ui',
  platforms: ['desktop'],
  contributes: {
    newTabTiles: HOST_NEW_TAB_TILES,
    preferencesSections: HOST_PREFERENCES_SECTIONS,
  },
};

/** What a `preferences:<id>` view module exports: the component as `default`. */
const prefsView =
  (load: () => Promise<unknown>) =>
  () =>
    load();

/** Lazy views for the sections; each resolves to `{ default: Component }`. */
export const hostUiBinding: FeatureModuleBinding = {
  id: 'host-ui',
  views: {
    'preferences:general': prefsView(() => import('../../components/PreferencesDialog/GeneralSection').then((m) => ({ default: m.GeneralSection }))),
    'preferences:typography': prefsView(() => import('../../components/PreferencesDialog/TypographySection').then((m) => ({ default: m.TypographySection }))),
    'preferences:fonts': prefsView(() => import('../../components/PreferencesDialog/FontsSection').then((m) => ({ default: m.FontsSection }))),
    'preferences:themes': prefsView(() => import('../../components/PreferencesDialog/ThemesSection').then((m) => ({ default: m.ThemesSection }))),
    'preferences:privacy': prefsView(() => import('../../components/PreferencesDialog/PrivacySection').then((m) => ({ default: m.PrivacySection }))),
    'preferences:extensions': prefsView(() => import('../../components/ExtensionsSection').then((m) => ({ default: m.ExtensionsSection }))),
    'preferences:apps': prefsView(() => import('../../components/PreferencesDialog/AppsSection').then((m) => ({ default: m.AppsSection }))),
    'preferences:advanced': prefsView(() => import('../../components/PreferencesDialog/AdvancedSection').then((m) => ({ default: m.AdvancedSection }))),
    'preferences:diagnostics': prefsView(() => import('../../components/diagnostics/DiagnosticsSettings').then((m) => ({ default: m.default }))),
  },
};

/** The `BUILTIN_MODULES` entry: `[hostUiManifest, hostUiBinding]`. */
export const hostUiModule = [hostUiManifest, hostUiBinding] as const;
