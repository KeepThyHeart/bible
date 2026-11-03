/**
 * Build-time release profile: which optional features this build ships.
 *
 * `electron.vite.config.ts` resolves `BIBLE_RELEASE_PROFILE` against
 * `release-profiles.json` and bakes the result in as two defines. With no
 * profile the defines are empty / 'on' and nothing is disabled, so dev builds
 * and tests behave exactly as before.
 *
 * Dependency-free (no `electron` import) so the main process, the preload and
 * the renderer can all use it, like `appConfig.ts`.
 */

declare const __BIBLE_DISABLED_MODULES__: string | undefined;
declare const __BIBLE_EXTENSIONS__: string | undefined;

/** Parse the comma-separated define into module ids. */
export function parseDisabledModules(text: string | undefined): string[] {
  return (text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Module ids the build removes (empty for a full build). */
export const RELEASE_DISABLED_MODULES: readonly string[] = parseDisabledModules(
  typeof __BIBLE_DISABLED_MODULES__ === 'string' ? __BIBLE_DISABLED_MODULES__ : undefined,
);

/** False when the build ships without the extension host, marketplace and Extensions preferences. */
export const RELEASE_EXTENSIONS_ENABLED: boolean =
  typeof __BIBLE_EXTENSIONS__ === 'string' ? __BIBLE_EXTENSIONS__ !== 'off' : true;

/** Feature-module overrides (`{ id: false }`) for the module hosts. Applies in every build, packaged or not. */
export function releaseModuleOverrides(disabled: readonly string[] = RELEASE_DISABLED_MODULES): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of disabled) out[id] = false;
  return out;
}
