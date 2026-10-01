/**
 * Activation event identifiers and helpers.
 *
 * Activation events are evaluated by the `ExtensionHost` whenever the
 * corresponding event happens in the host. When the conditions match, the
 * host spawns the extension's worker process if it isn't already running and
 * waits for `activate()` to resolve.
 *
 * Most activation events are PARAMETERIZED - they include a colon-separated
 * argument (e.g. `onView:bible`, `onCommand:ext.greekTools.openLexicon`).
 * The constants below are the *bare prefixes*; helper functions assemble the
 * fully-qualified strings to avoid typo-prone string concatenation in callers.
 */

import { EXTENSION_API_REGISTRY } from './Declarations/registry';

// --- Bare event identifiers ------------------------------------------------

/**
 * App finished cold-start - fired once, after the window is shown
 * (`main.ts`'s boot sequence). The only bare "activate at boot" event the
 * host fires as of task 0024 round 3 (P1.5). Prefer `onCommand:`/`onView:`
 * for lazy activation; reserve this for an extension that genuinely needs to
 * be running before any user interaction (e.g. a background indexer).
 *
 * Not an alias for the pre-P1.5 `'onStartup'` string, which is now rejected
 * outright (`ExtensionManifestValidator.ts`) - there was no released
 * ecosystem to keep compatible with it (see `EXTENSION_API_VERSION`'s own
 * doc comment: `0.1.0`, pre-release, one first-party extension in existence).
 */
export const ACT_ON_STARTUP_FINISHED = 'onStartupFinished' as const;

/**
 * Always activate at startup. **Disallowed for plugins** - built-ins only,
 * enforced by `ExtensionManifestValidator.ts` as of P1.5 (`isBuiltinOnlyEvent`).
 * No manifest in this codebase may declare it: there is no built-in-extension
 * concept today, so every extension is a plugin.
 */
export const ACT_STAR = '*' as const;

/** Session restore completed. */
export const ACT_ON_SESSION_LOADED = 'onSession:loaded' as const;

// --- Parameterized event prefixes ------------------------------------------

export const ACT_PREFIX_ON_VIEW = 'onView:' as const;
export const ACT_PREFIX_ON_COMMAND = 'onCommand:' as const;
export const ACT_PREFIX_ON_LANGUAGE = 'onLanguage:' as const;
export const ACT_PREFIX_ON_FILE_TYPE = 'onFileType:' as const;
export const ACT_PREFIX_ON_URI = 'onUri:' as const;
export const ACT_PREFIX_ON_CONTEXT = 'onContext:' as const;
export const ACT_PREFIX_ON_MODULE_INSTALLED = 'onModuleInstalled:' as const;
export const ACT_PREFIX_ON_MODULE_UPDATED = 'onModuleUpdated:' as const;
export const ACT_PREFIX_ON_PROVIDER_ROLE_SELECTED = 'onProviderRoleSelected:' as const;
export const ACT_PREFIX_ON_EXTENSION_API = 'onExtensionApi:' as const;
export const ACT_PREFIX_ON_AUTH_REQUIRED = 'onAuthRequired:' as const;
export const ACT_PREFIX_ON_TASK = 'onTask:' as const;

/** Search runs and the provider hasn't activated yet. Bare event, no parameter. */
export const ACT_ON_SEARCH_PROVIDER = 'onSearchProvider' as const;

// --- Helpers (purely string composition) -----------------------------------

/** `onView:bible` */
export function onView(contentType: string): string {
  return `${ACT_PREFIX_ON_VIEW}${contentType}`;
}

/** `onCommand:ext.greekTools.openLexicon` */
export function onCommand(commandId: string): string {
  return `${ACT_PREFIX_ON_COMMAND}${commandId}`;
}

/** `onLanguage:el` */
export function onLanguage(bcp47: string): string {
  return `${ACT_PREFIX_ON_LANGUAGE}${bcp47}`;
}

/** `onFileType:osis` */
export function onFileType(extension: string): string {
  return `${ACT_PREFIX_ON_FILE_TYPE}${extension}`;
}

/** `onUri:bible` */
export function onUri(scheme: string): string {
  return `${ACT_PREFIX_ON_URI}${scheme}`;
}

/** `onContext:editorFocused` */
export function onContext(contextKey: string): string {
  return `${ACT_PREFIX_ON_CONTEXT}${contextKey}`;
}

/** `onModuleInstalled:dictionary` */
export function onModuleInstalled(moduleType: string): string {
  return `${ACT_PREFIX_ON_MODULE_INSTALLED}${moduleType}`;
}

/** `onModuleUpdated:dictionary` */
export function onModuleUpdated(moduleType: string): string {
  return `${ACT_PREFIX_ON_MODULE_UPDATED}${moduleType}`;
}

/** `onProviderRoleSelected:strongsLookup` */
export function onProviderRoleSelected(roleId: string): string {
  return `${ACT_PREFIX_ON_PROVIDER_ROLE_SELECTED}${roleId}`;
}

/** `onExtensionApi:ext.greekTools` */
export function onExtensionApi(extensionId: string): string {
  return `${ACT_PREFIX_ON_EXTENSION_API}${extensionId}`;
}

/** `onAuthRequired:ext.greekTools.bibleCloud` */
export function onAuthRequired(providerId: string): string {
  return `${ACT_PREFIX_ON_AUTH_REQUIRED}${providerId}`;
}

/** `onTask:ext.greekTools.reindex` */
export function onTask(taskId: string): string {
  return `${ACT_PREFIX_ON_TASK}${taskId}`;
}

/** Returns true if the given event string is a wildcard event reserved for built-ins. */
export function isBuiltinOnlyEvent(event: string): boolean {
  return event === ACT_STAR;
}

// --- Vocabulary + firing-site bookkeeping (task 0024 round 3, P1.5) --------
//
// Before P1.5, `ExtensionManifestValidator` accepted any non-empty string as
// an activation event - a typo looked exactly like a working subscription.
// These lists let the validator reject anything outside the vocabulary above
// (`isKnownActivationEvent`) and let the host log a one-time warning for a
// syntactically valid event it has no firing site for (`isFiredActivationEvent`).

/**
 * Host-level bare events (not owned by any API namespace). Namespace-owned
 * events (`onCommand:`, `onView:`, `onContext:`, `onTask:`,
 * `onExtensionApi:`, `onProviderRoleSelected:`) come from the declaration
 * registry and are merged in below.
 */
const HOST_BARE_EVENTS: readonly string[] = [
  ACT_ON_STARTUP_FINISHED,
  ACT_STAR,
  ACT_ON_SESSION_LOADED,
  ACT_ON_SEARCH_PROVIDER,
];

/** Host-level parameterized prefixes no namespace declares. */
const HOST_EVENT_PREFIXES: readonly string[] = [
  ACT_PREFIX_ON_LANGUAGE,
  ACT_PREFIX_ON_FILE_TYPE,
  ACT_PREFIX_ON_URI,
  ACT_PREFIX_ON_MODULE_INSTALLED,
  ACT_PREFIX_ON_MODULE_UPDATED,
  ACT_PREFIX_ON_AUTH_REQUIRED,
];

/** Host-level events the host fires today (the registry adds the namespaces' fired ones). */
const HOST_FIRED_EVENTS: readonly string[] = [ACT_ON_STARTUP_FINISHED];

const REGISTRY_EVENTS = EXTENSION_API_REGISTRY.activationEvents;

function unique(list: readonly string[]): readonly string[] {
  return [...new Set(list)];
}

/** Bare (non-parameterized) events the vocabulary accepts: host-level + registry-declared. */
export const BARE_ACTIVATION_EVENTS: readonly string[] = unique([
  ...HOST_BARE_EVENTS,
  ...REGISTRY_EVENTS.filter((e) => !e.event.endsWith(':')).map((e) => e.event),
]);

/** Every parameterized prefix the vocabulary accepts: host-level + registry-declared. */
export const ACTIVATION_EVENT_PREFIXES: readonly string[] = unique([
  ...HOST_EVENT_PREFIXES,
  ...REGISTRY_EVENTS.filter((e) => e.event.endsWith(':')).map((e) => e.event),
]);

/**
 * The events the host actually fires (`onStartupFinished` at boot,
 * `onCommand:`/`onView:` on demand - see `DeclaredContributions.ts` and
 * `extensionHandlers.ts`'s `getPanelTypeUiEntry`). Anything else in the
 * vocabulary validates but never activates anything; declaring one is
 * not an error, but the host logs a warning per extension at load time
 * (`ExtensionHost.warnOnUnfiredActivationEvents` via `DeclaredContributions`).
 * Namespace events are fired per their declaration's `fired` flag.
 */
export const FIRED_ACTIVATION_EVENTS: readonly string[] = unique([
  ...HOST_FIRED_EVENTS,
  ...REGISTRY_EVENTS.filter((e) => e.fired).map((e) => e.event),
]);

/** True if `event` is a syntactically valid activation event (bare or prefixed with a real parameter). */
export function isKnownActivationEvent(event: string): boolean {
  if (BARE_ACTIVATION_EVENTS.includes(event)) return true;
  return ACTIVATION_EVENT_PREFIXES.some((p) => event.startsWith(p) && event.length > p.length);
}

/** True if the host has a firing site for `event` today (see `FIRED_ACTIVATION_EVENTS`). */
export function isFiredActivationEvent(event: string): boolean {
  return FIRED_ACTIVATION_EVENTS.some((e) => e === event || (e.endsWith(':') && event.startsWith(e)));
}
