/**
 * Item shapes for the contribution points added by task 0113 (beyond `apps`
 * and `verseActions`). Data only and identical on both platforms; the code that
 * renders an item (a panel component, a settings view) is bound separately per
 * platform through a feature module binding's `views` table and loads lazily.
 *
 * Ids are persisted in places (dockview layouts, sessions, the right-pane mode,
 * settings) so they are STABLE: a panel type that shipped as `wordStudy` stays
 * `wordStudy` when it moves into a module.
 */

import type { AppIcon } from '../Apps/AppDescriptor';
import type { SettingDef } from '../Settings/SettingsRegistry';
import type { ContributionItem } from './ContributionRegistry';
import type { HostPlatform, LabelRef, LazyLoader } from './types';

/** Desktop dockview panel type (`contributes.panelTypes`). `id` is the persisted `contentType`. */
export interface PanelTypeContribution extends ContributionItem {
  readonly id: string;
  readonly title: LabelRef;
  readonly icon?: AppIcon;
  readonly order?: number;
  readonly platforms?: readonly HostPlatform[];
  /** Panels of this type whose content key names the item shown (commentary:`<module>`). Informational. */
  readonly keyed?: boolean;
}

/** Web right-pane mode (`contributes.paneModes`): a tab in the right pane and, optionally, a phone view. */
export interface PaneModeContribution extends ContributionItem {
  /** The persisted `rightPaneMode`. */
  readonly id: string;
  readonly title: LabelRef;
  readonly icon?: AppIcon;
  readonly order?: number;
  readonly platforms?: readonly HostPlatform[];
  /** Survives a reload (default true). `search` is the example of one that must not. */
  readonly restorable?: boolean;
  /** Also a view of the phone layout (default false). */
  readonly phoneView?: boolean;
  /** Once opened, the pane stays mounted (hidden) while another tab is active, so its state survives tab switches (default false). */
  readonly keepMounted?: boolean;
}

/** What a new-tab tile opens. */
export type TileTarget =
  | { readonly panelType: string }
  | { readonly appId: string }
  | { readonly commandId: string }
  /** A plain link to a separate page (`/watch`): no app code runs. */
  | { readonly href: string };

/** A tile on the new-tab page (desktop) or home screen (web). */
export interface NewTabTileContribution extends ContributionItem {
  readonly id: string;
  readonly title: LabelRef;
  readonly icon?: AppIcon;
  readonly order?: number;
  readonly platforms?: readonly HostPlatform[];
  readonly target: TileTarget;
  /** Extra words the new-tab search matches (`plans` for reading plans). */
  readonly keywords?: readonly string[];
  /** Cheap data predicate over host state. */
  readonly when?: string;
}

/** A group of settings (`contributes.settings`), merged into the app's settings registry. */
export interface SettingsContribution extends ContributionItem {
  /** The settings group id (`SettingDef.group`). */
  readonly id: string;
  readonly defs: readonly SettingDef[];
  readonly platforms?: readonly HostPlatform[];
}

/** A section of the preferences dialog (desktop) or settings panel (web). */
export interface PreferencesSectionContribution extends ContributionItem {
  readonly id: string;
  readonly title: LabelRef;
  readonly icon?: AppIcon;
  readonly order?: number;
  readonly platforms?: readonly HostPlatform[];
  /** Settings group (`SettingDef.group`) rendered generically when the section has no custom view. */
  readonly settingsGroup?: string;
  /** Tab/page of the host dialog the section belongs to (`general`, `reading`, ...). Default: its own entry. */
  readonly parent?: string;
  readonly when?: string;
}

/** An item in the status bar. */
export interface StatusBarItemContribution extends ContributionItem {
  readonly id: string;
  readonly title: LabelRef;
  readonly alignment: 'left' | 'right';
  readonly order?: number;
  readonly platforms?: readonly HostPlatform[];
  /** Command run on click, if any. */
  readonly commandId?: string;
  readonly when?: string;
}

/** `contributes.i18nNamespace`: a catalog namespace loaded on demand (see `i18nNamespaceFile`). */
export interface I18nNamespaceContribution extends ContributionItem {
  /** The namespace, equal to the module id by default. */
  readonly id: string;
}

/** A group of server routes a module mounts (informational; the server binding's code registers them). */
export interface ServerRouteContribution extends ContributionItem {
  readonly id: string;
  /** Mount path, e.g. `/api/quiz`. Informational. */
  readonly path?: string;
}

/** One lazily loaded view (`views` point), keyed `<kind>:<id>`. */
export interface ViewContribution extends ContributionItem {
  readonly id: string;
  readonly load: LazyLoader<unknown>;
}

/** `panel:wordStudy`, `pane:similar`, `preferences:quiz`, `status:audio`. */
export type ViewKind = 'panel' | 'pane' | 'preferences' | 'status' | 'tile';

export function viewId(kind: ViewKind, id: string): string {
  return `${kind}:${id}`;
}

/** The catalog file of a module namespace: `locales/<locale>/<ns>.json`. */
export function i18nNamespaceFile(locale: string, namespace: string): string {
  return `${locale}/${namespace}.json`;
}
