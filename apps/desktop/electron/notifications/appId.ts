/**
 * The application id used as the Windows AppUserModelID, which must match the
 * one electron-builder gives the installer's shortcut or toasts do not show.
 * `__BIBLE_APP_ID__` is injected by electron-vite's `define` (electron.vite.config.ts)
 * from the same `BIBLE_APP_ID` the builder reads; if it is absent the env var and
 * then the builder's default are used. main.ts only sets the id when packaged.
 */
declare const __BIBLE_APP_ID__: string | undefined;

export const DEFAULT_APP_ID = 'com.bibledesktopapp.app';

const defined = typeof __BIBLE_APP_ID__ === 'string' ? __BIBLE_APP_ID__ : undefined;

export function resolveAppId(env: NodeJS.ProcessEnv = process.env): string {
  return defined?.trim() || env.BIBLE_APP_ID?.trim() || DEFAULT_APP_ID;
}
