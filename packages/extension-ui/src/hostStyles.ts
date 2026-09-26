/**
 * Host styling for panel iframes: links the host's theme sheet and the KTH
 * design-token sheet, and keeps the theme in step with the host.
 *
 * The host serves both from the reserved `ext-ui://host` origin. `theme.css`
 * carries the active theme's tokens. When the user switches theme the host
 * pushes `theme.changed`; a `<link>` that is already loaded does not re-fetch,
 * so the sheet is re-linked with `?theme=<id>` (a new URL, a new fetch). The old
 * sheet stays applied until the new one has loaded, so there is no unstyled
 * flash in between.
 *
 * Nothing here uses `innerHTML`; the only inputs are theme ids validated
 * against a strict pattern.
 */

export const HOST_THEME_CSS = 'ext-ui://host/theme.css';
export const HOST_KIT_CSS = 'ext-ui://host/kit/1/kth.css';

const THEME_ID = /^[a-z0-9-]{1,40}$/;
/** If a new sheet neither loads nor errors within this time, swap anyway. */
const SWAP_FALLBACK_MS = 3000;

export interface HostStylesOptions {
  /** Also link `kit/1/kth.css` (KTH tokens, base rules and `kth-*` classes). Default true. */
  kthCss?: boolean;
}

/** The slice of {@link BibleExtUI} that `useHostStyles` needs (structural, so tests can fake it). */
export interface ThemeSource {
  getTheme(): Promise<{ mode: string }>;
  onThemeChanged(cb: (t: { mode: string }) => void): { dispose(): void };
}

/**
 * Link the host theme (and, unless disabled, KTH) stylesheets, set
 * `data-theme` on `<html>`, and follow live theme changes.
 *
 * A static `<link rel="stylesheet" href="ext-ui://host/theme.css">` already in
 * the page is adopted rather than duplicated (a static link avoids a first-paint
 * flash). Returns a handle; `dispose()` stops following theme changes and leaves
 * the links in place.
 */
export function useHostStyles(bible: ThemeSource, opts: HostStylesOptions = {}): { dispose(): void } {
  const doc = document;
  const head = doc.head ?? doc.documentElement;
  const find = (prefix: string): HTMLLinkElement | undefined =>
    Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).find((l) =>
      l.getAttribute('href')?.startsWith(prefix),
    );
  const make = (href: string): HTMLLinkElement => {
    const l = doc.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    return l;
  };

  let current = find(HOST_THEME_CSS) ?? head.appendChild(make(HOST_THEME_CSS));
  if (opts.kthCss !== false && !find(HOST_KIT_CSS)) current.after(make(HOST_KIT_CSS));

  let pending: HTMLLinkElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const setDataTheme = (id: string): void => doc.documentElement.setAttribute('data-theme', id);

  const apply = (mode: unknown): void => {
    if (disposed || typeof mode !== 'string' || !THEME_ID.test(mode)) return;
    setDataTheme(mode);
    // A newer switch supersedes an unfinished one.
    pending?.remove();
    clearTimeout(timer);
    const next = make(`${HOST_THEME_CSS}?theme=${encodeURIComponent(mode)}`);
    pending = next;
    const swap = (): void => {
      if (pending !== next) return;
      clearTimeout(timer);
      current.remove();
      current = next;
      pending = null;
    };
    next.addEventListener('load', swap, { once: true });
    next.addEventListener('error', swap, { once: true }); // never strand two sheets
    timer = setTimeout(swap, SWAP_FALLBACK_MS);
    // Right after the old sheet, so kth.css stays later in the cascade.
    current.after(next);
  };

  const sub = bible.onThemeChanged((t) => apply(t?.mode));
  bible.getTheme().then(
    (t) => {
      if (!disposed && typeof t?.mode === 'string' && THEME_ID.test(t.mode)) setDataTheme(t.mode);
    },
    () => {},
  );

  return {
    dispose(): void {
      disposed = true;
      sub.dispose();
      clearTimeout(timer);
    },
  };
}
