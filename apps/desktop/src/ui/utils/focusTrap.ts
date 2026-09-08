/**
 * Focus trap utility - keeps keyboard focus contained within a given container
 * element while a modal/dialog is open. Used by `useFocusTrap`.
 *
 * Behavior:
 * - On activation, moves focus to the first focusable element (or a supplied
 *   initial target).
 * - Intercepts Tab/Shift+Tab to cycle focus within the container.
 * - Optionally closes the dialog on Escape (see `onEscape`).
 * - On release, restores focus to the element that was focused before activation.
 */

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
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  });
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
}

export function activateFocusTrap(
  container: HTMLElement,
  options: FocusTrapOptions = {},
): FocusTrapHandle {
  const previouslyFocused =
    (document.activeElement as HTMLElement | null) ?? null;

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

  const focusFirst = () => {
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
    const active = document.activeElement as HTMLElement | null;
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
  const rafId = window.requestAnimationFrame(focusFirst);
  container.addEventListener('keydown', handleKeyDown);

  return {
    release: () => {
      window.cancelAnimationFrame(rafId);
      container.removeEventListener('keydown', handleKeyDown);
      if (addedTabIndex) {
        container.removeAttribute('tabindex');
      }
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        // Guard against the previous element having been removed from the DOM.
        if (document.contains(previouslyFocused)) {
          previouslyFocused.focus();
        }
      }
    },
  };
}
