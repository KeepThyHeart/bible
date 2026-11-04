/**
 * F6 / Shift+F6 region navigation (B-113). Pure DOM, no React.
 *
 * Regions are the header, the app rail, every pane and the status bar, in
 * document order. A pane carries `data-kth-region="pane"` (+ role=region and a
 * label); the header, rail and footer are matched by their own markers.
 *
 * FOCUS-RETURN RULE (followed by every handler that removes or blurs the
 * focused element): after the new UI renders (one animation frame) focus moves
 * to (a) the heading/primary element of what replaced it (tabIndex=-1 heading);
 * else (b) the invoking element if still connected; else (c) `focusRegion()` of
 * the region it happened in. Never `blur()` to body.
 */

export const REGION_SELECTOR = '[data-kth-region], nav.app-rail';

const TABBABLE =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

const lastFocus = new WeakMap<Element, HTMLElement>();

function defaultIsVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function listRegions(
  root: ParentNode = document,
  isVisible: (el: HTMLElement) => boolean = defaultIsVisible
): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(REGION_SELECTOR)).filter(
    (el) =>
      !el.closest('[hidden],[inert],[aria-hidden="true"]') &&
      !el.closest('[aria-modal="true"]') &&
      isVisible(el)
  );
}

export function currentRegionIndex(
  regions: HTMLElement[],
  active: Element | null = document.activeElement
): number {
  if (!active) return -1;
  // Innermost region wins (a pane inside a larger region).
  let best = -1;
  regions.forEach((r, i) => {
    if (r.contains(active) && (best === -1 || regions[best].contains(r))) best = i;
  });
  return best;
}

function regionOf(el: Element | null): HTMLElement | null {
  return (el?.closest(REGION_SELECTOR) as HTMLElement | null) ?? null;
}

/**
 * `rescue` = focus was lost (not moved by the user): skip the F6 memory (which can
 * hold a stale marker such as a note indicator) and never jump into the search box.
 */
export function focusRegion(region: HTMLElement, rescue = false): void {
  const remembered = lastFocus.get(region);
  if (!rescue && remembered && remembered.isConnected && region.contains(remembered)) {
    remembered.focus();
    return;
  }
  const paneTarget = region.querySelector<HTMLElement>('[data-pane-focus]');
  if (paneTarget) {
    paneTarget.focus();
    return;
  }
  const kind = region.getAttribute('data-kth-region') ?? (region.matches('nav.app-rail') ? 'rail' : '');
  if (kind === 'header' && !rescue) {
    const input = region.querySelector<HTMLInputElement>('input');
    if (input) {
      input.focus();
      input.select?.();
      return;
    }
  }
  if (kind === 'rail') {
    const current = region.querySelector<HTMLElement>('[aria-current="page"],[aria-selected="true"],[aria-pressed="true"]');
    if (current) {
      current.focus();
      return;
    }
  }
  const first = region.querySelector<HTMLElement>(TABBABLE);
  if (first) {
    first.focus();
    return;
  }
  if (!region.hasAttribute('tabindex')) region.setAttribute('tabindex', '-1');
  region.focus();
}

export function cycleRegion(dir: 1 | -1, root: ParentNode = document, isVisible?: (el: HTMLElement) => boolean): void {
  // Dialogs own their focus trap.
  if (document.querySelector('[aria-modal="true"]')) return;
  const regions = listRegions(root, isVisible);
  if (regions.length === 0) return;
  const cur = currentRegionIndex(regions);
  const next = cur === -1 ? (dir === 1 ? 0 : regions.length - 1) : (cur + dir + regions.length) % regions.length;
  const target = regions[next];
  // Activate the dockview panel first: setActive() can move focus itself.
  const panelId = target.getAttribute('data-panel-id');
  if (panelId) activatePanel?.(panelId);
  focusRegion(target);
  if (panelId) {
    // Dockview may re-assert focus after its own activation; settle it.
    requestAnimationFrame(() => {
      if (!target.contains(document.activeElement)) focusRegion(target);
    });
  }
}

/** Installed by the app so a pane region made active by keyboard also becomes dockview's active panel. */
let activatePanel: ((panelId: string) => void) | undefined;
export function setPanelActivator(fn: ((panelId: string) => void) | undefined): void {
  activatePanel = fn;
}

/**
 * Installs the F6 / Shift+F6 window listener (capture phase, so it wins over
 * the note editor and inputs), the focus memory, and the focus-rescue backstop.
 */
export function installRegionNavigation(doc: Document = document): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'F6' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    cycleRegion(e.shiftKey ? -1 : 1, doc);
  };
  const onFocusIn = (e: FocusEvent): void => {
    const t = e.target as HTMLElement | null;
    const r = regionOf(t);
    if (t && r && t !== r) lastFocus.set(r, t);
  };
  // Browsers do not reliably fire focusout when the focused node is removed,
  // so watch the DOM: focus on body + the last focused node gone = rescue.
  let tracked: { el: Element; region: HTMLElement | null } | null = null;
  // The few elements focused before it: a closed menu's trigger is the right place to return to.
  let history: Element[] = [];
  const trackFocus = (e: FocusEvent): void => {
    const t = e.target as Element | null;
    if (t && t !== doc.body) {
      tracked = { el: t, region: regionOf(t) };
      history = [...history.filter((h) => h !== t), t].slice(-6);
    }
  };
  const focusInvoker = (snap: { el: Element; region: HTMLElement | null }): boolean => {
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h === snap.el || !h.isConnected || !(h instanceof HTMLElement)) continue;
      if (regionOf(h) !== snap.region || h.closest('[hidden],[inert],[aria-hidden="true"]')) continue;
      h.focus();
      return doc.activeElement === h;
    }
    return false;
  };
  const rescue = (): void => {
    const snap = tracked;
    if (!snap || snap.el.isConnected) return;
    requestAnimationFrame(() => {
      if (
        doc.activeElement === doc.body &&
        !snap.el.isConnected &&
        !doc.querySelector('[aria-modal="true"]')
      ) {
        // The region may be gone too (a closed pane): fall back to the
        // Bible pane the reader was in, else the first pane.
        const fallback = snap.region?.isConnected
          ? snap.region
          : (doc.querySelector<HTMLElement>('[data-tour-pane="bible"][data-kth-region]') ??
             doc.querySelector<HTMLElement>('[data-kth-region="pane"]'));
        if (!fallback) return;
        tracked = null;
        if (snap.region?.isConnected && focusInvoker(snap)) return;
        focusRegion(fallback, true);
      }
    });
  };
  // A pane closing can leave focus on body even though the element we last
  // focused (elsewhere) still exists: dockview resets it. Treat any removed
  // region as a reason to check.
  const regionRemoved = (records: MutationRecord[]): boolean =>
    records.some((r) =>
      Array.from(r.removedNodes).some(
        (n) => n instanceof HTMLElement && (n.matches(REGION_SELECTOR) || n.querySelector(REGION_SELECTOR))
      )
    );
  const observer = new MutationObserver((records) => {
    rescue();
    if (!regionRemoved(records)) return;
    requestAnimationFrame(() => {
      if (doc.activeElement !== doc.body || doc.querySelector('[aria-modal="true"]')) return;
      const fallback =
        doc.querySelector<HTMLElement>('[data-tour-pane="bible"][data-kth-region]') ??
        doc.querySelector<HTMLElement>('[data-kth-region="pane"]');
      if (fallback) focusRegion(fallback, true);
    });
  });
  observer.observe(doc.body, { childList: true, subtree: true });

  doc.defaultView?.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusin', trackFocus);

  return () => {
    doc.defaultView?.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusin', trackFocus);
    observer.disconnect();

  };
}
