/**
 * Site banners (site-config `banners`): pure helpers. The server has validated the
 * shape; this picks the language, the text color and the dismissed set.
 */

export type LocalizedText = string | Record<string, string>;

export interface SiteBanner {
  id: string;
  message: LocalizedText;
  color?: string;
  textColor?: string;
  dismissible: boolean;
  link?: { url: string; label: LocalizedText };
}

/** The entry for `lang` (exact, then its base language), else `en`, else the first entry. */
export function pickText(text: LocalizedText | undefined, lang: string): string {
  if (typeof text === 'string') return text;
  if (!text) return '';
  const base = lang.split('-')[0];
  return text[lang] ?? text[base] ?? text.en ?? Object.values(text)[0] ?? '';
}

/** Banners from a client config value; anything malformed is skipped. */
export function parseBanners(value: unknown): SiteBanner[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (b): b is SiteBanner => !!b && typeof b === 'object' && typeof b.id === 'string' && (typeof b.message === 'string' || (typeof b.message === 'object' && b.message !== null)),
  );
}

/** 'black' or 'white', whichever reads better on a #rgb/#rrggbb/rgb() background; white when unknown. */
export function contrastText(color: string | undefined): string {
  if (!color) return '#fff';
  let r: number, g: number, b: number;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(color);
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (rgb) {
    [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  } else return '#fff';
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#000' : '#fff';
}

const KEY = 'kth.dismissedBanners';

export function dismissedBannerIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Remember a dismissal in this browser (a convenience; silently skipped if storage is blocked). */
export function rememberDismissed(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set([...dismissedBannerIds(), id])]));
  } catch {
    // storage blocked: dismissed for this page view only
  }
}
