/**
 * Maps core's `NavItem` (data) to `@bible/ui`'s `AppNavEntry` (resolved
 * strings and a rendered icon) for the rail, tiles and phone sheet.
 */
import { useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import type { AppIcon, LabelRef, NavItem } from '@bible/core/browser';
import type { AppNavEntry } from '@bible/ui';

type Translate = (key: string, fallback: string) => string;

/** A LabelRef in the UI language: i18n key with its English fallback, or the extension's own text. */
export function resolveLabel(t: Translate, ref: LabelRef): string {
  if ('key' in ref) return t(ref.key, ref.fallback);
  const text = ref.text;
  return typeof text === 'string' ? text : t(text.key, text.key);
}

/** Builtin icons are Font Awesome names (`fa-tv`); images render through `<img>`. */
export function renderAppIcon(icon: AppIcon) {
  if (icon.kind === 'image') return <img src={icon.src} alt="" width={20} height={20} />;
  return <i class={`fa-solid ${icon.name}`} aria-hidden="true" />;
}

export function shortcutHint(slot: number | undefined): string | undefined {
  return slot ? `Ctrl+Shift+${slot}` : undefined;
}

export function toNavEntries(items: readonly NavItem[], t: Translate): AppNavEntry[] {
  return items.map((item) => {
    const entry: AppNavEntry = {
      id: item.id,
      title: resolveLabel(t, item.title),
      icon: renderAppIcon(item.icon),
      busy: item.busy,
    };
    if (item.shortTitle) entry.shortTitle = resolveLabel(t, item.shortTitle);
    if (item.badge) entry.badge = { ...item.badge };
    const hint = shortcutHint(item.shortcutSlot);
    if (hint) entry.shortcutHint = hint;
    return entry;
  });
}

export function useNavEntries(items: readonly NavItem[]): AppNavEntry[] {
  const { t, i18n } = useTranslation();
  return useMemo(
    () => toNavEntries(items, (key, fallback) => t(key, fallback)),
    // `t` changes identity with the language.
    [items, i18n?.language, t],
  );
}
