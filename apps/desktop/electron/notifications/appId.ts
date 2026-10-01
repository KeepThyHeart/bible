/**
 * The application id used as the Windows AppUserModelID, which must match the
 * one electron-builder gives the installer's shortcut or toasts do not show.
 * `__BIBLE_APP_ID__` is meant to be injected by electron-vite's `define` from
 * the same `BIBLE_APP_ID` the builder reads; until it is, the env var (set when
 * running unpackaged) and then the builder's default are used.
 */
declare const __BIBLE_APP_ID__: string | undefined;

export const DEFAULT_APP_ID = 'com.bibledesktopapp.app';

const defined = typeof __BIBLE_APP_ID__ === 'string' ? __BIBLE_APP_ID__ : undefined;

export function resolveAppId(env: NodeJS.ProcessEnv = process.env): string {
  return defined?.trim() || env.BIBLE_APP_ID?.trim() || DEFAULT_APP_ID;
}
