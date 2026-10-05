/**
 * Verse actions: the `verseActions` contribution point (task 0080).
 *
 * M1 defines the shapes only; the registry implementation, the platform menus
 * and the extension `registerContextMenu('verse')` adapter are M2 (rows 2, 6, 9).
 * The registry will be `ContributionRegistry<VerseActionContribution>` (key
 * `verseActions`) plus the handler bindings below; the feature-module host
 * can already register contributions into any `ContributionPoint`.
 *
 * Data and code are split like apps: the contribution (label, order, `when`)
 * is small and loads at boot so the menu can be drawn; the handler's code is
 * a lazy loader fetched the first time the action runs.
 */

import type { ContributionItem, ContributionRegistry } from '../Modules/ContributionRegistry';
import type { Disposable, LabelRef } from '../Modules/types';
import type { AppIcon, AppId } from './AppDescriptor';

/** One item of `contributes.verseActions` (data only). */
export interface VerseActionContribution extends ContributionItem {
  /** `present.sendVerse`; extensions: `ext.<id>.<action>`. */
  readonly id: string;
  readonly title: LabelRef;
  readonly icon?: AppIcon;
  /** The app this action belongs to (for grouping and the "Open <app>" follow-up), if any. */
  readonly appId?: AppId;
  /** Context expression over the verse context and host state (cheap, data only). */
  readonly when?: string;
  readonly order?: number;
  /** Menu group for separators: `app` (default), `copy`, `study`, ... */
  readonly group?: string;
}

/** What a handler receives: the verse or selection the user acted on. */
export interface VerseActionContext {
  /** The first verse of the selection. */
  readonly verseId: number;
  /** Every selected verse, in order. */
  readonly verseIds: readonly number[];
  /** The translation the verse was acted on in. */
  readonly module: string;
  /** Where the menu was opened (`reader`, `search`, `phoneSheet`, ...). */
  readonly surface: string;
}

/** The lazily loaded half of a verse action. */
export interface VerseActionHandler {
  run(ctx: VerseActionContext): void | Promise<void>;
}

/** Platform binding for one action: `load: () => import('./present/verseActions').then(m => m.sendVerse)`. */
export interface VerseActionBinding {
  readonly id: string;
  load(): Promise<VerseActionHandler>;
}

/** M2: the registry the menus read. */
export interface IVerseActionRegistry extends Pick<
  ContributionRegistry<VerseActionContribution>,
  'key' | 'register' | 'disposeBySource' | 'get' | 'list' | 'subscribe' | 'getSnapshot'
> {
  /** Attach the platform handler for a contributed action. */
  bindHandler(binding: VerseActionBinding): Disposable;
  /**
   * Run an action: fires `onVerseAction:<id>` (activating its feature module),
   * loads the handler once, then runs it. Rejects if the action is unknown or
   * has no handler on this platform.
   */
  run(id: string, ctx: VerseActionContext): Promise<void>;
}
