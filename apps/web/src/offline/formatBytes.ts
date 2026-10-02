/**
 * Localized byte sizes with a GB step (binary units), matching the Settings header ("Storage 12.3 MB").
 * Shared by the offline pack section; the `Localizer` comes from `useLocalizer()`.
 *
 * Licence: GPL-3.0-or-later.
 */

import type { Localizer } from '@bible/core/browser';

export function formatBytesLocalized(bytes: number, localizer: Pick<Localizer, 'formatNumber'>): string {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const fixed1 = (v: number) => localizer.formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (n < 1024) return `${localizer.formatNumber(n)} B`;
  if (n < 1024 * 1024) return `${fixed1(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${fixed1(n / (1024 * 1024))} MB`;
  return `${fixed1(n / (1024 * 1024 * 1024))} GB`;
}
