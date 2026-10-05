/**
 * The standard set of contribution points an app creates at boot and hands to
 * `createFeatureModuleHost({ points })`. `apps` and `verseActions` keep their
 * own richer classes (task 0080); everything else is a plain
 * `ContributionRegistry`. One call per app keeps the key names in one place.
 */

import { ContributionRegistry } from './ContributionRegistry';
import type { ContributionItem, ContributionPoint } from './ContributionRegistry';
import type {
  I18nNamespaceContribution,
  NewTabTileContribution,
  PaneModeContribution,
  PanelTypeContribution,
  PreferencesSectionContribution,
  ServerRouteContribution,
  SettingsContribution,
  StatusBarItemContribution,
} from './Contributions';
import { ViewRegistry } from './ViewRegistry';

export interface StandardPoints {
  readonly panelTypes: ContributionRegistry<PanelTypeContribution>;
  readonly paneModes: ContributionRegistry<PaneModeContribution>;
  readonly newTabTiles: ContributionRegistry<NewTabTileContribution>;
  readonly settings: ContributionRegistry<SettingsContribution>;
  readonly preferencesSections: ContributionRegistry<PreferencesSectionContribution>;
  readonly statusBarItems: ContributionRegistry<StatusBarItemContribution>;
  readonly serverRoutes: ContributionRegistry<ServerRouteContribution>;
  readonly i18nNamespace: ContributionRegistry<I18nNamespaceContribution>;
  readonly views: ViewRegistry;
}

export function createStandardPoints(): StandardPoints {
  return {
    panelTypes: new ContributionRegistry<PanelTypeContribution>('panelTypes'),
    paneModes: new ContributionRegistry<PaneModeContribution>('paneModes'),
    newTabTiles: new ContributionRegistry<NewTabTileContribution>('newTabTiles'),
    settings: new ContributionRegistry<SettingsContribution>('settings'),
    preferencesSections: new ContributionRegistry<PreferencesSectionContribution>('preferencesSections'),
    statusBarItems: new ContributionRegistry<StatusBarItemContribution>('statusBarItems'),
    serverRoutes: new ContributionRegistry<ServerRouteContribution>('serverRoutes'),
    i18nNamespace: new ContributionRegistry<I18nNamespaceContribution>('i18nNamespace'),
    views: new ViewRegistry(),
  };
}

/** The standard points as the array `createFeatureModuleHost` takes (add `apps` and `verseActions` yourself). */
export function standardPointList(points: StandardPoints): ContributionPoint<ContributionItem>[] {
  return Object.values(points) as unknown as ContributionPoint<ContributionItem>[];
}
