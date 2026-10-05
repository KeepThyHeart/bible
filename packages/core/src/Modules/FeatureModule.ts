/**
 * The feature-module contract ("internal extensions", task 0080 M1; extended
 * by task 0113).
 *
 * A feature module is a product feature (Presenter, Quiz, Reading plans, ...)
 * described the way an extension is: a **data-only manifest** that loads at
 * boot, plus a **lazy binding** per platform whose code loads only when one of
 * the manifest's activation events fires. The rules, VS Code style:
 *
 * 1. Boot loads manifests only. A disabled module (flag off, dev override,
 *    wrong platform, a required module off) loads no code and registers no
 *    contributions.
 * 2. Code loads on an activation event: `onApp:<id>`, `onCommand:<id>`,
 *    `onVerseAction:<id>`, `onPanel:<type>`, `onSetting:<key>`, or the
 *    explicit opt-in `onStartupFinished`. Every contributed app, verse action
 *    and command adds its own event implicitly (`onApp:present`). There is no
 *    `*` and no eager default.
 * 3. Core events (`HookEventName`) reach a module only if its manifest
 *    declares interest (`hooks`), only while it is active, and only when the
 *    hook's `when` (a cheap data predicate the host evaluates) holds. An
 *    inactive module costs nothing per event: dispatch walks an index of the
 *    *active* subscribers of that event.
 * 4. `activate()` returns Disposables; deactivation (feature switched off at
 *    runtime) disposes them and removes the module's hook subscriptions.
 *
 * `contributes` uses the extension manifest's vocabulary and key names, so a
 * feature can move between built-in and extension without changing its
 * manifest. In M1 only `apps` and `verseActions` are wired contribution
 * points; `commands` is typed (the extension shape) but not registered yet.
 */

import type { ContributedCommand } from '../Extensions/ExtensionManifest';
import type { AppDescriptor } from '../Apps/AppDescriptor';
import type { VerseActionContribution } from '../Apps/VerseActions';
import type { FeatureFlagName } from '../Settings/FeatureFlags';
import type {
  NewTabTileContribution,
  PaneModeContribution,
  PanelTypeContribution,
  PreferencesSectionContribution,
  ServerRouteContribution,
  SettingsContribution,
  StatusBarItemContribution,
} from './Contributions';
import type { Disposable, HostPlatform } from './types';

// --- Contributes vocabulary -------------------------------------------------

/**
 * What a feature module contributes. Same key names as
 * `ExtensionContributes`; each wired key is served by one
 * `ContributionPoint` registered with the feature-module host.
 */
export interface Contributes {
  /** Apps (task 0080). Extensions: `contributes.apps` (M3), mapped onto the same registry. */
  readonly apps?: readonly AppDescriptor[];
  /** Verse/selection actions (task 0080). Extensions: their `registerContextMenu('verse')` items, adapted (M2). */
  readonly verseActions?: readonly VerseActionContribution[];
  /** Placeholder (task 0113): the extension manifest's command shape. Not registered in M1. */
  readonly commands?: readonly ContributedCommand[];
  /** Desktop dockview panel types (task 0113). Ids are the persisted `contentType`s: stable. */
  readonly panelTypes?: readonly PanelTypeContribution[];
  /** Web right-pane modes and phone views (task 0113). */
  readonly paneModes?: readonly PaneModeContribution[];
  readonly newTabTiles?: readonly NewTabTileContribution[];
  /** Setting definitions, merged into the platform's settings registry. */
  readonly settings?: readonly SettingsContribution[];
  readonly preferencesSections?: readonly PreferencesSectionContribution[];
  readonly statusBarItems?: readonly StatusBarItemContribution[];
  /** Server routes this module mounts (web server only; the code is the server binding's `load`). */
  readonly serverRoutes?: readonly ServerRouteContribution[];
  /** A catalog namespace (`locales/<locale>/<ns>.json`) loaded on demand. */
  readonly i18nNamespace?: string;
  // To add a key: its type here, a ContributionPoint (StandardPoints.ts), and
  // (if it carries ids) its implicit activation event below.
}

export type ContributesKey = keyof Contributes;

/** Keys with a contribution point in M1. A manifest using another key gets a warning, not an error. */
export const WIRED_CONTRIBUTION_KEYS: readonly ContributesKey[] = [
  'apps',
  'verseActions',
  'panelTypes',
  'paneModes',
  'newTabTiles',
  'settings',
  'preferencesSections',
  'statusBarItems',
  'serverRoutes',
  'i18nNamespace',
];

// --- Activation events ------------------------------------------------------

/** Event prefixes; the part after the colon is a contributed id, panel type or setting key. */
export const ACTIVATION_EVENT_PREFIXES = ['onApp:', 'onCommand:', 'onVerseAction:', 'onPanel:', 'onSetting:'] as const;

/** Bare events. Only ever opt-in. */
export const BARE_ACTIVATION_EVENTS = ['onStartupFinished'] as const;

export type ActivationEvent =
  | `onApp:${string}`
  | `onCommand:${string}`
  | `onVerseAction:${string}`
  | `onPanel:${string}`
  | `onSetting:${string}`
  | (typeof BARE_ACTIVATION_EVENTS)[number];

export function isActivationEvent(value: string): value is ActivationEvent {
  if ((BARE_ACTIVATION_EVENTS as readonly string[]).includes(value)) return true;
  return ACTIVATION_EVENT_PREFIXES.some((p) => value.startsWith(p) && value.length > p.length && !/\s/.test(value));
}

/** Implicit activation events: one per contributed app, verse action and command. */
export function implicitActivationEvents(contributes: Contributes): ActivationEvent[] {
  const out: ActivationEvent[] = [];
  for (const a of contributes.apps ?? []) out.push(`onApp:${a.id}`);
  for (const v of contributes.verseActions ?? []) out.push(`onVerseAction:${v.id}`);
  for (const c of contributes.commands ?? []) out.push(`onCommand:${c.id}`);
  for (const p of contributes.panelTypes ?? []) out.push(`onPanel:${p.id}`);
  for (const p of contributes.paneModes ?? []) out.push(`onPanel:${p.id}`);
  for (const group of contributes.settings ?? []) {
    for (const def of group.defs) out.push(`onSetting:${def.key}`);
  }
  return out;
}

// --- Core hook events -------------------------------------------------------

/**
 * Core events a module may declare interest in. M1 defines the vocabulary and
 * the dispatch rules; the host apps add dispatch sites as features migrate
 * (0113). Payloads are typed per event below.
 */
export interface HookEventPayloads {
  /** The reader's current verse changed. */
  'reader.verseChanged': { readonly verseId: number; readonly module: string };
  /** A chapter finished rendering in a reader pane. */
  'reader.chapterRendered': { readonly book: number; readonly chapter: number; readonly module: string };
  /** The verse selection changed (empty array: cleared). */
  'reader.selectionChanged': { readonly verseIds: readonly number[]; readonly module: string };
  /** An app became the active app. */
  'app.didActivate': { readonly appId: string };
  /** A setting changed. */
  'settings.changed': { readonly key: string };
}

export type HookEventName = keyof HookEventPayloads;

export const HOOK_EVENT_NAMES: readonly HookEventName[] = [
  'reader.verseChanged',
  'reader.chapterRendered',
  'reader.selectionChanged',
  'app.didActivate',
  'settings.changed',
];

/** A manifest's declared interest in a core event. */
export interface HookInterest {
  readonly event: HookEventName;
  /** Cheap predicate the host evaluates before calling the handler (e.g. `present.live`). */
  readonly when?: string;
}

// --- Manifest ---------------------------------------------------------------

/** Data only: loaded at boot for every module, enabled or not. */
export interface FeatureModuleManifest {
  /** `present`, `quiz`. Lowercase, dashes allowed. */
  readonly id: string;
  /**
   * The off switch. When set, the module is enabled only while the flag
   * resolves on (desktop ignores site config: it passes its own resolver).
   * Unset: on unless a dev override turns it off.
   */
  readonly flag?: FeatureFlagName;
  /** Default: both platforms. */
  readonly platforms?: readonly HostPlatform[];
  /** Modules that must be enabled for this one to be; they are activated first. */
  readonly requires?: readonly string[];
  /** Explicit activation events, beyond the implicit ones from `contributes`. */
  readonly activationEvents?: readonly ActivationEvent[];
  /** Core events this module wants while active. */
  readonly hooks?: readonly HookInterest[];
  readonly contributes: Contributes;
}

// --- Binding (code) ---------------------------------------------------------

export interface FeatureModuleContext {
  readonly moduleId: string;
  readonly platform: HostPlatform;
  /** The event that activated the module. */
  readonly activationEvent: string;
  /** Push anything to undo on deactivation. */
  readonly subscriptions: Disposable[];
}

/** What a module's lazily loaded code exports. */
export interface FeatureModuleExports {
  /** Set the module up. Return (or push to `ctx.subscriptions`) what deactivation must undo. */
  activate?(ctx: FeatureModuleContext): void | Disposable | Promise<void | Disposable>;
  /** Handlers for the hook events the manifest declares. Undeclared events are never delivered. */
  readonly hooks?: { readonly [E in HookEventName]?: (payload: HookEventPayloads[E]) => void };
}

/**
 * Per platform: `{ id: 'present', load: () => import('./present/module'), views: {...} }`.
 *
 * - `load` is the module's activation code; omit it for a module that only
 *   contributes data and views (nothing to run).
 * - `views` maps `<kind>:<id>` (`panel:wordStudy`, `pane:similar`,
 *   `preferences:quiz`) to a lazy import of the component. The table is plain
 *   data (functions that have not been called): registering it imports
 *   nothing, and a disabled module registers none of it.
 */
export interface FeatureModuleBinding {
  readonly id: string;
  load?(): Promise<FeatureModuleExports>;
  readonly views?: Readonly<Record<string, () => Promise<unknown>>>;
}

// --- Validation -------------------------------------------------------------

const MODULE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface ManifestCheck {
  readonly errors: string[];
  readonly warnings: string[];
}

/** Check a built-in manifest. Errors are programming mistakes (the host throws); warnings are logged. */
export function checkFeatureModuleManifest(m: FeatureModuleManifest): ManifestCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!MODULE_ID_RE.test(m.id)) errors.push(`id "${m.id}" must be lowercase words joined by dashes`);
  for (const ev of m.activationEvents ?? []) {
    if (!isActivationEvent(ev)) errors.push(`${m.id}: unknown activation event "${ev}"`);
  }
  for (const h of m.hooks ?? []) {
    if (!HOOK_EVENT_NAMES.includes(h.event)) errors.push(`${m.id}: unknown hook event "${String(h.event)}"`);
  }
  for (const req of m.requires ?? []) {
    if (req === m.id) errors.push(`${m.id}: requires itself`);
  }
  for (const key of Object.keys(m.contributes ?? {})) {
    if (!(WIRED_CONTRIBUTION_KEYS as readonly string[]).includes(key)) {
      warnings.push(`${m.id}: contributes.${key} has no contribution point yet; ignored`);
    }
  }
  const all = [...(m.activationEvents ?? []), ...implicitActivationEvents(m.contributes ?? {})];
  if (all.length === 0 && (m.hooks?.length ?? 0) > 0) {
    warnings.push(`${m.id}: declares hooks but no activation event, so its hooks can never run`);
  }
  return { errors, warnings };
}
