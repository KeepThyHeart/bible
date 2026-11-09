/**
 * Focus trap utility - keeps keyboard focus contained within a given container
 * element while a modal/dialog is open. Used by `useFocusTrap`.
 *
 * Behavior:
 * - On activation, moves focus to the first focusable element (or a supplied
 *   initial target) - unless focus has already moved inside the container by
 *   the time that deferred step runs (a fast click), which it leaves alone.
 * - Intercepts Tab/Shift+Tab to cycle focus within the container.
 * - Optionally closes the dialog on Escape (see `onEscape`).
 * - On release, restores focus to the element that was focused before activation.
 *   When that element is gone (a menu item that closed as the dialog opened),
 *   falls back to the most recent still-connected element focused before it -
 *   normally the menu's own button - so focus never drops to <body> and gets
 *   "rescued" onto the Bible pane heading by regionNavigation.
 * - By default makes everything outside the container `inert` while the trap is
 *   active (every user of this util is an `aria-modal` dialog); pass
 *   `inertBackground: false` for a non-modal popup.
 */

import { inertBackground } from './inertBackground';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  return nodes.filter((el) => {
    // Hidden or disabled elements aren't tab-reachable.
    if (el.hasAttribute('disabled')) return false;
    // Roving-tabindex members (unselected radios, tabs) are focusable but not
    // part of the Tab order; counting them would break the wrap-around.
    if (el.getAttribute('tabindex') === '-1') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  });
}

/**
 * Recently focused elements per document, oldest first. Lets a trap that is
 * released find the opener even when the element that was focused at
 * activation time is already gone.
 */
const FOCUS_HISTORY_LIMIT = 8;
const focusHistories = new WeakMap<Document, HTMLElement[]>();

function trackFocusHistory(doc: Document): HTMLElement[] {
  let history = focusHistories.get(doc);
  if (history) return history;
  const list: HTMLElement[] = [];
  focusHistories.set(doc, list);
  doc.addEventListener(
    'focusin',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target || target === doc.body || target === doc.documentElement) return;
      const index = list.indexOf(target);
      if (index !== -1) list.splice(index, 1);
      list.push(target);
      if (list.length > FOCUS_HISTORY_LIMIT) list.shift();
    },
    true,
  );
  return list;
}

/**
 * The most recent keydown per document, seen in the capture phase. A trap
 * released while that event is still being dispatched (a field whose Enter
 * handler closed the dialog - React commits it before the event finishes
 * bubbling) can still cancel it; see `release`.
 */
const lastKeydowns = new WeakMap<Document, KeyboardEvent>();
const trackedKeydownDocs = new WeakSet<Document>();

function trackKeydowns(doc: Document): void {
  if (trackedKeydownDocs.has(doc)) return;
  trackedKeydownDocs.add(doc);
  doc.addEventListener('keydown', (e) => lastKeydowns.set(doc, e), true);
}

function canReceiveFocus(el: HTMLElement, doc: Document): boolean {
  return (
    el.isConnected &&
    el.ownerDocument === doc &&
    typeof el.focus === 'function' &&
    !el.closest('[inert],[hidden],[aria-hidden="true"]') &&
    !(el as HTMLButtonElement).disabled
  );
}

export interface FocusTrapHandle {
  release: () => void;
}

export interface FocusTrapOptions {
  initialFocus?: HTMLElement | null;
  /**
   * Called when Escape is pressed inside the container. Propagation is stopped
   * first, so when dialogs are nested only the innermost trap reacts and the
   * outer dialog stays open.
   */
  onEscape?: () => void;
  /**
   * Make the rest of the page inert while the trap is active (default true).
   * Pass false for a non-modal popup that must leave the page interactive.
   */
  inertBackground?: boolean;
}

export function activateFocusTrap(
  container: HTMLElement,
  options: FocusTrapOptions = {},
): FocusTrapHandle {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const history = trackFocusHistory(doc);
  trackKeydowns(doc);
  const previouslyFocused = (doc.activeElement as HTMLElement | null) ?? null;
  // Snapshot now: the history keeps changing once focus moves into the dialog.
  const openerCandidates = [...history].filter((el) => !container.contains(el));
  const restoreInert =
    options.inertBackground === false ? null : inertBackground(container);

  // Keep the container itself focusable - but not tab-reachable - for the whole
  // lifetime of the trap. Clicking inert content inside a dialog (a heading, a
  // paragraph) otherwise blurs focus all the way out to <body>, and the keydown
  // listener below would never see the following keystrokes because they no
  // longer bubble through the container. `getFocusableElements` skips
  // `[tabindex="-1"]`, so this does not change the Tab cycle.
  const addedTabIndex = !container.hasAttribute('tabindex');
  if (addedTabIndex) {
    container.setAttribute('tabindex', '-1');
  }

  // Whatever held focus when the trap went up (the opener, or an autoFocus
  // field inside the dialog). If focus has moved into the dialog since, the
  // user (or the dialog) already chose where it goes: the deferred initial
  // focus must not pull it back.
  const focusAtActivation = doc.activeElement;
  const focusFirst = () => {
    const current = doc.activeElement;
    if (current !== focusAtActivation && current && container.contains(current)) return;
    const initial = options.initialFocus ?? null;
    if (initial && container.contains(initial)) {
      initial.focus();
      return;
    }
    const focusables = getFocusableElements(container);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      // Fall back to the container itself so screen readers announce its content.
      container.focus();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      // No handler supplied - leave Escape alone so callers that only wanted a
      // focus trap keep whatever Escape handling they already had.
      if (!options.onEscape) return;
      event.stopPropagation();
      options.onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = getFocusableElements(container);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = doc.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  // Defer focus until after the container has mounted its children.
  const rafId = win.requestAnimationFrame(focusFirst);
  container.addEventListener('keydown', handleKeyDown);

  return {
    release: () => {
      win.cancelAnimationFrame(rafId);
      container.removeEventListener('keydown', handleKeyDown);
      if (addedTabIndex) {
        container.removeAttribute('tabindex');
      }
      // Closed by an Enter keydown (a field that submits and closes the
      // dialog): once that keydown finishes, the browser sends the key's
      // keypress to whatever has focus, and Chromium activates a focused
      // button on keypress - so the opener we are about to refocus would be
      // clicked and the dialog would open again. Cancelling the keydown while
      // it is still in dispatch suppresses that keypress; the key has already
      // done its job.
      const keydown = lastKeydowns.get(doc);
      if (keydown && keydown.key === 'Enter' && keydown.eventPhase !== 0) {
        keydown.preventDefault();
      }
      // Un-inert first: an inert element cannot take focus.
      restoreInert?.();
      // Do not steal focus from something the app already focused after the
      // dialog went away (e.g. a handler that moved focus on purpose).
      const current = doc.activeElement as HTMLElement | null;
      if (current && current !== doc.body && !container.contains(current) && current.isConnected) {
        return;
      }
      if (
        previouslyFocused &&
        previouslyFocused !== doc.body &&
        canReceiveFocus(previouslyFocused, doc)
      ) {
        previouslyFocused.focus();
        return;
      }
      // The opener is gone: walk back to the most recent surviving element.
      for (let i = openerCandidates.length - 1; i >= 0; i--) {
        const candidate = openerCandidates[i];
        if (candidate === previouslyFocused || !canReceiveFocus(candidate, doc)) continue;
        candidate.focus();
        if (doc.activeElement === candidate) return;
      }
    },
  };
}
