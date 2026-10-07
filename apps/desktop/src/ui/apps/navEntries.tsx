import type { LabelRef, NavItem } from '@bible/core/browser';
import type { AppNavEntry } from '@bible/ui';
import { translateWithDefault } from '../hooks/useXrefGraphLabels';
import type { II18nService } from '../services/II18nService';
import { AppIconGlyph } from './AppIconGlyph';

type T = (key: string, params?: Record<string, unknown>) => string;

/** Resolve a descriptor label: built-ins by catalog key with the English fallback, extensions by their own l10n. */
export function resolveLabelRef(ref: LabelRef, t: T, i18n: Pick<II18nService, 'resolve'>): string {
  if ('key' in ref) return translateWithDefault(t, ref.key, ref.fallback);
  // An extension manifest string `%key%` names a key in the extension's own l10n catalog, which the
  // renderer holds under `ext.<extensionId>.` (see the l10n bridge). A key missing from every catalog
  // shows the bare key rather than `[ext.x.key]`.
  if (typeof ref.text === 'string') {
    const m = /^%(.+)%$/.exec(ref.text);
    if (m) {
      const full = `ext.${ref.extensionId}.${m[1]}`;
      const out = i18n.resolve({ key: full } as never);
      return out === `[${full}]` || out === full ? m[1]! : out;
    }
  }
  const text = ref.text as unknown;
  if (typeof text === 'object' && text !== null && typeof (text as { key?: unknown }).key === 'string') {
    // `{ key }` is a key of the extension's own catalog too: try it namespaced first.
    const own = i18n.resolve({ ...(text as object), key: `ext.${ref.extensionId}.${(text as { key: string }).key}` } as never);
    if (!/^\[.*\]$/.test(own)) return own;
  }
  return i18n.resolve(ref.text as never);
}

export function shortcutHint(slot: number | undefined, isMac: boolean): string | undefined {
  if (slot === undefined) return undefined;
  return `${isMac ? 'Cmd' : 'Ctrl'}+Shift+${slot}`;
}

/** Items for the shared `@bible/ui` rail and tile grid: resolved strings and rendered icons. */
export function toNavEntries(
  items: readonly NavItem[],
  t: T,
  i18n: Pick<II18nService, 'resolve'>,
  isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform),
): AppNavEntry[] {
  return items.map((item) => {
    const hint = shortcutHint(item.shortcutSlot, isMac);
    return {
      id: item.id,
      title: resolveLabelRef(item.title, t, i18n),
      ...(item.shortTitle ? { shortTitle: resolveLabelRef(item.shortTitle, t, i18n) } : {}),
      icon: <AppIconGlyph icon={item.icon} />,
      ...(item.badge ? { badge: item.badge } : {}),
      busy: item.busy,
      ...(hint ? { shortcutHint: hint } : {}),
    };
  });
}
