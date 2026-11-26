/**
 * Read access to the two history preferences (task 0224) for stores that must
 * not import `usePreferencesStore` (it would close an import cycle through the
 * text-settings store). The preferences store registers itself here.
 */
export interface PrivacyPrefs {
  reopenSearchTabs: boolean;
  rememberReadingHistory: boolean;
}

let reader: (() => PrivacyPrefs) | null = null;

export function registerPrivacyPrefsReader(fn: () => PrivacyPrefs): void {
  reader = fn;
}

/** The private defaults (both off) until the preferences store has registered. */
export function getPrivacyPrefs(): PrivacyPrefs {
  return reader ? reader() : { reopenSearchTabs: false, rememberReadingHistory: false };
}
