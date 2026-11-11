/**
 * The small, repeated pieces: the "..." menu, bars, empty states, modals.
 *
 * Collected here rather than repeated in each view so that one control means
 * one thing everywhere. Everything returns a detached element. Nothing here
 * reads state, schedules work, or touches the worker.
 *
 * The host gives extension panels colour and font tokens only - no button or
 * toolbar styles - so this panel keeps its own small flat controls in
 * `memory.css` and `styles/*.css`.
 */

import { append, button, el, focusQuietly } from './dom';
import { tr } from './i18n';
import { inertBackground } from './inert';
import { clampPercent } from './format';

// ---------------------------------------------------------------------------
// "..." menu
// ---------------------------------------------------------------------------

/** One entry in a `menu()` panel. */
export interface MenuItem {
  label: string;
  onClick: () => void;
}

/**
 * The "..." menu: a trigger button showing an ellipsis glyph (with `label` as
 * its `aria-label`) plus a `role="menu"` popover of `role="menuitem"` buttons.
 * It holds the secondary actions of a screen, a verse row or a list chip.
 *
 * Not a native `<select>` or a `window.*` dialog: this panel runs inside a
 * sandboxed iframe where the host can suppress modal dialogs outright, and a
 * `<select>` cannot be given the roving Up/Down behaviour or the
 * Escape/outside-close behaviour a `role="menu"` needs. `attachMenuKeys`
 * below is the `role="menu"` keyboard handler: vertical arrows move between
 * `menuitem`s that are never in the page's own Tab order while the menu is
 * open. The panel is anchored to the trigger's inline end edge, so it opens
 * toward the inside of the screen in both LTR and RTL.
 */
export function menu(opts: { label: string; items: MenuItem[] }): HTMLElement {
  const wrapper = el('div', { class: 'sm-menu' });

  const panel = el('div', {
    class: 'sm-menu-panel',
    hidden: true,
    attrs: { role: 'menu', 'aria-label': opts.label },
  });

  const itemButtons = opts.items.map((item) =>
    button(
      item.label,
      () => {
        closeMenu();
        item.onClick();
      },
      { class: 'sm-menu-item', attrs: { role: 'menuitem', tabindex: '-1' } },
    ),
  );
  append(panel, itemButtons);

  const trigger = button(opts.label, () => (panel.hidden ? openMenu() : closeMenu()), {
    class: 'sm-btn sm-btn-quiet sm-btn-small sm-menu-btn',
    text: '',
    attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': opts.label, title: opts.label },
  });
  // A plain ellipsis; the accessible name comes from aria-label.
  append(trigger, [el('span', { class: 'sm-menu-btn-glyph', text: '\u2026', attrs: { 'aria-hidden': 'true' } })]);

  // Registered only while the menu is open, and torn down the moment it
  // closes by any route - Escape, an item press, or this handler firing
  // itself - so an open panel never leaves a document-level listener behind
  // once the interaction that needed it is over. A panel left open when the
  // screen it lives on is replaced (a rare path: every item press already
  // closes first) leaks the listener only until the next pointerdown
  // anywhere in the document, which finds `wrapper` detached, does not match
  // it, and calls `closeMenu()` anyway - a self-cleaning one-shot rather than
  // a lasting leak.
  let outsideListener: ((ev: PointerEvent) => void) | null = null;

  function openMenu(): void {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    setRoving(0);
    focusQuietly(itemButtons[0] ?? null);

    outsideListener = (ev: PointerEvent) => {
      if (ev.target instanceof Node && wrapper.contains(ev.target)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', outsideListener, true);
  }

  function closeMenu(): void {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (outsideListener) {
      document.removeEventListener('pointerdown', outsideListener, true);
      outsideListener = null;
    }
  }

  function setRoving(index: number): void {
    itemButtons.forEach((b, i) => {
      b.tabIndex = i === index ? 0 : -1;
    });
  }

  attachMenuKeys(panel, itemButtons, setRoving, () => {
    closeMenu();
    focusQuietly(trigger);
  });

  append(wrapper, [trigger, panel]);
  return wrapper;
}

/**
 * Up/Down over an open `role="menu"`, wrapping at the ends, plus Escape - the
 * `role="menu"` analogue of `attachTabKeys` below. Home/End jump to the ends and Tab closes the
 * menu (focus returns to the trigger and the Tab moves on from there);
 * Left/Right are a tablist's own pattern and are left out.
 */
export function attachMenuKeys(
  panel: HTMLElement,
  itemButtons: HTMLButtonElement[],
  setRoving: (index: number) => void,
  onEscape: () => void,
): void {
  if (itemButtons.length === 0) return;

  panel.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      onEscape();
      return;
    }
    if (ev.key === 'Tab') {
      // Close and put focus back on the trigger, but let the Tab itself
      // proceed so focus moves on from there instead of leaving the menu open.
      onEscape();
      return;
    }

    const current = itemButtons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;

    let target = -1;
    switch (ev.key) {
      case 'ArrowDown':
        target = (current + 1) % itemButtons.length;
        break;
      case 'ArrowUp':
        target = (current - 1 + itemButtons.length) % itemButtons.length;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = itemButtons.length - 1;
        break;
      default:
        return;
    }

    ev.preventDefault();
    setRoving(target);
    focusQuietly(itemButtons[target] ?? null);
  });
}

// ---------------------------------------------------------------------------
// Tab keys
// ---------------------------------------------------------------------------

/**
 * Left/Right/Home/End over a tab strip, wrapping at the ends - adapted from
 * the picker's own `attachListKeys` in `practiceView.ts` (~lines 1170-1210):
 * the same roving-focus idea, narrowed to the two horizontal arrows a
 * tablist's own ARIA pattern calls for (no up/down, no digit shortcut) and
 * extended to move `tabindex` itself, which the picker's plain buttons never
 * needed because they were never taken out of the normal Tab order.
 *
 * The arrows move focus only; they do not select. Selecting a tab on the
 * passage screen re-fetches and redraws the whole screen (`goPassage`), and
 * firing that on every arrow press would tear out the very strip the
 * keyboard focus is moving through. A `<button>` already turns Enter/Space
 * into a click, so activating the focused tab needs no extra handling here.
 */
export function attachTabKeys(list: HTMLElement, tabButtons: HTMLButtonElement[]): void {
  if (tabButtons.length === 0) return;

  list.addEventListener('keydown', (ev) => {
    const current = tabButtons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;

    let target = -1;
    switch (ev.key) {
      case 'ArrowRight':
        target = (current + 1) % tabButtons.length;
        break;
      case 'ArrowLeft':
        target = (current - 1 + tabButtons.length) % tabButtons.length;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = tabButtons.length - 1;
        break;
      default:
        return;
    }

    ev.preventDefault();
    tabButtons.forEach((t, i) => {
      t.tabIndex = i === target ? 0 : -1;
    });
    focusQuietly(tabButtons[target] ?? null);
  });
}


/**
 * The "there is nothing here yet" panel.
 *
 * Takes an action because an empty state without one is a dead end: the plan
 * screen with no passages is the first thing a new user sees, and telling them
 * it is empty without telling them what to do about it wastes the only screen
 * that has their full attention.
 */
export function emptyState(
  message: string,
  detail?: string,
  action?: HTMLElement,
): HTMLElement {
  return el('div', { class: 'sm-empty', attrs: { role: 'status' } }, [
    el('p', { class: 'sm-empty-message', text: message }),
    detail !== undefined ? el('p', { class: 'sm-empty-detail', text: detail }) : null,
    action ?? null,
  ]);
}

/**
 * An error the user is meant to read and act on.
 *
 * `role="alert"` because these appear in response to something the user just
 * did - most often a reference that would not parse - and a message that
 * appears silently beside the field is a message a screen reader user never
 * learns about.
 */
export function errorBanner(message: string): HTMLElement {
  return el('p', {
    class: 'sm-error',
    text: message,
    attrs: { role: 'alert' },
  });
}

/** The translation a passage is memorised in, shown beside its reference (B-123). */
export function translationTag(moduleId: string): HTMLElement {
  return el('span', {
    class: 'sm-row-meta sm-row-translation',
    text: moduleId,
    attrs: { title: tr('memory.ui.common.translationTitle', 'Translation: {module}', { module: moduleId }) },
  });
}
/** A glyph-only button with an accessible name; used by `modal()`'s close control. */
function iconButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  return button(glyph, onClick, {
    class: 'sm-btn sm-btn-quiet sm-btn-small sm-icon-btn',
    title: label,
    attrs: { 'aria-label': label },
  });
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

/** What `modal()` needs to build and behave. */
export interface ModalOptions {
  /** Heading text, also used to build the dialog's accessible name. */
  title: string;
  /** The modal's body, fixed at construction. Swap content inside a wrapper element you pass here. */
  body: (HTMLElement | string)[];
  /** Optional footer controls (a right-aligned button row). Omitted or empty: no footer. */
  actions?: HTMLElement[];
  /**
   * Called each time the modal closes - Esc, a backdrop click, the built-in
   * close button, or `handle.close()` - after it is hidden and focus is
   * restored. Typical use: remove `handle.element` from `document.body` when
   * the caller mounted it there for a one-shot popup.
   */
  onClose?: () => void;
}

/** What `modal()` hands back: the detached element to mount, and open/close controls. */
export interface ModalHandle {
  /**
   * The whole `.sm-modal-backdrop` subtree, detached and starting `hidden`.
   * The caller mounts it (once) wherever it likes, then drives visibility
   * with `open()`/`close()`.
   */
  element: HTMLElement;
  /** Shows the modal, remembers the focused element, and moves focus to the first focusable control. */
  open: () => void;
  /** Hides the modal, restores focus to whatever had it at `open()`, then calls `onClose`. No-op if already closed. */
  close: () => void;
}

let modalIdSeq = 0;

const MODAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One modal component for everything: a plain `<div class="sm-modal-backdrop">`
 * wrapping a `<div role="dialog" aria-modal="true">` - never the native
 * `<dialog>`/`showModal()` (jsdom support is partial, `::backdrop` sits
 * outside the `--sm-*` token layer) and never `window.confirm` (a sandboxed
 * iframe can suppress it).
 *
 * Content is fixed at construction; build a fresh `modal()` per open for
 * fresh content, or replace children of a wrapper element you passed in
 * `body`. The caller mounts `element` itself, like `menu()`.
 * A header close button (`✕`), Esc, and a click on the backdrop itself all
 * close it; clicks inside the dialog do not.
 */
export function modal(opts: ModalOptions): ModalHandle {
  modalIdSeq += 1;
  const titleId = `sm-modal-title-${modalIdSeq}`;

  const closeButton = iconButton('✕', tr('memory.ui.common.close', 'Close'), () => closeModal());
  const header = el('div', { class: 'sm-modal-header' }, [
    el('h2', { class: 'sm-modal-title', id: titleId, text: opts.title }),
    closeButton,
  ]);
  const bodyEl = el('div', { class: 'sm-modal-body' }, opts.body);
  const children: HTMLElement[] = [header, bodyEl];
  if (opts.actions && opts.actions.length > 0) {
    children.push(el('div', { class: 'sm-modal-actions' }, opts.actions));
  }

  // `tabindex="-1"` is not in the tab order; it only gives `open` something
  // to focus when nothing inside is focusable.
  const dialog = el('div', {
    class: 'sm-modal',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
  }, children);

  const backdrop = el('div', { class: 'sm-modal-backdrop', hidden: true }, [dialog]);

  let opener: HTMLElement | null = null;
  let releaseInert: (() => void) | null = null;

  function focusableElements(): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR));
  }

  function openModal(): void {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backdrop.hidden = false;
    releaseInert?.();
    releaseInert = inertBackground(dialog);
    focusQuietly(focusableElements()[0] ?? dialog);
  }

  function closeModal(): void {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    releaseInert?.();
    releaseInert = null;
    focusQuietly(opener);
    opener = null;
    opts.onClose?.();
  }

  // Only a direct press on the backdrop itself closes it; one bubbling up
  // from inside `dialog` has a different `ev.target`.
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) closeModal();
  });

  attachModalKeys(dialog, focusableElements, closeModal);

  return { element: backdrop, open: openModal, close: closeModal };
}

/**
 * Escape plus a full Tab/Shift+Tab focus trap over an open dialog. Every Tab
 * is resolved by hand (current index in, wrapped neighbour out) so one
 * handler behaves identically in a browser and in jsdom, which does not move
 * focus on Tab.
 */
function attachModalKeys(
  dialog: HTMLElement,
  focusableElements: () => HTMLElement[],
  onEscape: () => void,
): void {
  dialog.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      onEscape();
      return;
    }
    if (ev.key !== 'Tab') return;

    ev.preventDefault();
    const focusables = focusableElements();
    if (focusables.length === 0) {
      focusQuietly(dialog);
      return;
    }

    const current = focusables.indexOf(document.activeElement as HTMLElement);
    const last = focusables.length - 1;
    const target = ev.shiftKey
      ? focusables[current <= 0 ? last : current - 1]!
      : focusables[current === -1 || current === last ? 0 : current + 1]!;

    focusQuietly(target);
  });
}

/**
 * A labelled horizontal bar, drawn in CSS.
 *
 * No chart library: there is nothing to load one from, and a handful of bars
 * do not justify one anyway. `role="img"` with a complete label, because the
 * visual is the whole content and a bare div conveys none of it.
 */
export function bar(fraction: number, label: string): HTMLElement {
  const percent = clampPercent(fraction);
  return el(
    'div',
    { class: 'sm-bar', attrs: { role: 'img', 'aria-label': label } },
    [el('div', { class: 'sm-bar-fill', style: { width: `${percent}%` } })],
  );
}

/** A number with a caption under it. */
export function statTile(value: string, caption: string): HTMLElement {
  return el('div', { class: 'sm-stat' }, [
    el('div', { class: 'sm-stat-value', text: value }),
    el('div', { class: 'sm-stat-caption', text: caption }),
  ]);
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/**
 * The names `icon()` knows how to draw.
 *
 * `home` and `menu` are chrome, not activities. The other six are activity
 * icons: `ordering`, `refmatch`, `refprovide`, `blanks` and `firstletters`
 * name the five rungs (see `Rung` in `types.ts`); `variety` is the one
 * remaining name with no `Rung` of its own - it is a mix of activities, not
 * one - which is why this stays its own union rather than `Rung` plus one,
 * even now that every other tile has landed its own exercise.
 */
export type IconName =
  | 'home'
  | 'menu'
  | 'variety'
  | 'refmatch'
  | 'ordering'
  | 'blanks'
  | 'firstletters'
  | 'refprovide'
  | 'recite';

/**
 * The strokes each icon is built from, one `<path>` per entry.
 *
 * All eight share a 24x24 viewBox and a 2px round-capped stroke so that
 * mixing them in one row (the nav, an activity tile grid) never reads as two
 * icon sets. A couple of names could not be told apart by shape alone at this
 * size, so the choices are deliberate: `variety`'s crossing diagonals read as
 * "shuffle/mix" where `refmatch`'s two opposing horizontal arrows read as
 * "match this to that"; `ordering`'s up/down arrow beside ranked lines reads
 * as "put these in order" where plain `menu` is three even, unranked ones.
 */
const ICON_PATHS: Readonly<Record<IconName, readonly string[]>> = {
  // A house: roof, walls, and a door - the one non-abstract icon here, since
  // it names a screen ("Home") rather than an activity.
  home: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  // Three even bars - the nav's own "more" affordance, unranked on purpose so
  // it never doubles as a fourth activity icon.
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  // A shuffle glyph: two crossing diagonals, each with its own arrowhead.
  variety: ['M16 3h5v5', 'M4 20L21 3', 'M21 16v5h-5', 'M15 15l6 6', 'M4 4l5 5'],
  // Two arrows pointing at each other, top-right and bottom-left - matching
  // one thing to another rather than a single directional move.
  refmatch: ['M3 7h11', 'M10 3l4 4-4 4', 'M21 17H10', 'M14 13l-4 4 4 4'],
  // A vertical up/down arrow beside three lines of increasing length - lines
  // that have a rank, and an affordance for moving one up or down it.
  ordering: ['M4 5v14', 'M2 8l2-3 2 3', 'M2 16l2 3 2-3', 'M10 6h8', 'M10 12h10', 'M10 18h6'],
  // Two short word-strokes with a longer underline between them - the blank
  // sitting where a word has been removed.
  blanks: ['M3 9h4', 'M9 14h6', 'M17 9h4'],
  // A capital "A", stroked rather than set as text so it is one more path
  // among equals rather than a font dependency.
  firstletters: ['M4 19L10 4L16 19', 'M6.5 13h7'],
  // A bookmark - the passage's own place kept, which is what "provide the
  // reference" is asking the user to recall.
  refprovide: ['M6 3h12v18l-6-4-6 4z'],
  // A microphone: capsule, pickup arc and stand - saying it aloud.
  recite: ['M9 3a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A small inline icon, built with `createElementNS` rather than a markup
 * string - `dom.ts`'s header explains why there is no `innerHTML` path
 * anywhere in this bundle, and an icon set is not worth being the exception.
 *
 * `stroke="currentColor"` so an icon always matches the text colour of
 * whatever control it sits in without a per-caller override, and
 * `aria-hidden="true"` because every call site pairs an icon with visible
 * text (a toolbar title, an activity label) - the icon is decoration, and a
 * screen reader announcing "home icon, Home" on top of that text would be
 * noise, not help.
 */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '1em');
  svg.setAttribute('height', '1em');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `sm-icon sm-icon-${name}`);

  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }

  return svg;
}
