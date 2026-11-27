/**
 * Remembering how the user likes their printouts: layout and notes margin.
 *
 * Kept apart from the Copy dialog's own preferences (format and options), so choosing a block quote for
 * the clipboard does not change what the printer gets. What a valid record is belongs to `@bible/core`
 * (`normalizePrintPreferences`); this file only owns the key. A first-time user, malformed JSON or an
 * unavailable localStorage all land on core's defaults: numbered verses, no block-quote line, no margin.
 */
import { defaultPrintUnit, normalizePrintPreferences, type PrintPreferences } from '@bible/core';

/** Inches for a US locale, centimetres elsewhere, until the user chooses. */
function localeUnit() {
  return defaultPrintUnit(typeof navigator === 'undefined' ? undefined : navigator.language);
}

const PRINT_PREFERENCES_KEY = 'bible-desktop-print-preferences';

export function loadPrintPreferences(): PrintPreferences {
  try {
    const raw = localStorage.getItem(PRINT_PREFERENCES_KEY);
    return normalizePrintPreferences(raw ? JSON.parse(raw) : null, localeUnit());
  } catch {
    return normalizePrintPreferences(null, localeUnit());
  }
}

export function savePrintPreferences(prefs: PrintPreferences): void {
  try {
    localStorage.setItem(PRINT_PREFERENCES_KEY, JSON.stringify(normalizePrintPreferences(prefs, prefs.unit)));
  } catch {
    // A preference that cannot be saved is not worth interrupting printing for.
  }
}
