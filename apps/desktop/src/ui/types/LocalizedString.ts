/**
 * A user-facing string that may either be a literal (already-localized) or a
 * reference into the i18n catalog. The registry stores `LocalizedString` values
 * as-is and resolves them through `II18nService.resolve()` at read time, so a
 * locale change re-renders without re-registering.
 */

export type LocalizedString =
  | string
  | { key: string; params?: Record<string, unknown> };

/**
 * Accepts `unknown` rather than `LocalizedString` so it can also be used to
 * sniff ICU parameter values, which are typed `unknown` and may legitimately
 * carry a nested catalog reference (see `I18nService.resolveParams`).
 */
export function isLocalizedKey(
  value: unknown,
): value is { key: string; params?: Record<string, unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof (value as { key: unknown }).key === 'string'
  );
}
