/**
 * Platform-aware wording for file-manager and trash actions. The app is the
 * same on every OS, but "Explorer" and "Recycle Bin" are Windows words.
 */

export type DesktopOs = 'win' | 'mac' | 'other';

/** The OS the renderer runs on: the preload's `electron.platform` if present, else the browser's own hint. */
export function currentOs(): DesktopOs {
  const bridge = (globalThis as { window?: { electron?: { platform?: string } } }).window?.electron;
  const p = bridge?.platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '');
  if (/^win|^Win/.test(p)) return 'win';
  if (/^darwin|Mac/i.test(p)) return 'mac';
  return 'other';
}

/** i18n key for "Reveal in Explorer / Finder / file manager". `base` is the Windows key. */
export function revealKey<K extends string>(base: K, os: DesktopOs = currentOs()): string {
  return os === 'win' ? base : os === 'mac' ? `${base}Mac` : `${base}Other`;
}

/** i18n key for "Delete (Recycle Bin)" on Windows, "Delete (Trash)" on macOS and Linux. */
export function deleteKey<K extends string>(base: K, os: DesktopOs = currentOs()): string {
  return os === 'win' ? base : `${base}Trash`;
}
