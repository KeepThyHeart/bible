/**
 * Plain-English summary of what diagnostic reports contain and what they
 * deliberately do NOT contain. Shown in the crash dialog, the Report an
 * Issue dialog, and the Settings panel. Keep this generic - it covers any
 * diagnostic report regardless of type.
 *
 * Wording must match the spec (section 2.4) and be reviewable at a glance: users
 * trust this paragraph when they decide whether to send a report. That is also
 * why the text itself is in `locales/en/ui.json` under
 * `diagnostics.privacyBlurb` rather than here - a promise about privacy has to
 * be reviewable in the same place as every other user-facing string, and has to
 * be translatable, since the readers most likely to depend on it are not
 * necessarily reading English.
 */

/** The blurb, resolved from the catalog. */
export function getDiagnosticsPrivacyBlurb(t: (key: string) => string): string {
  return t('diagnostics.privacyBlurb');
}
