/**
 * Activation event identifiers and helpers.
 *
 * Spec A section "Activation events".
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

// --- Bare event identifiers ------------------------------------------------

/** App finished cold-start. Discouraged - the manifest validator warns on its use. */
export const ACT_ON_STARTUP_FINISHED = 'onStartupFinished' as const;

/** Always activate at startup. **Disallowed for plugins** - built-ins only. */
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
