/**
 * The small, repeated pieces: the toolbar, level boxes, bars, empty states.
 *
 * Collected here rather than repeated in each view so that a level box means
 * one thing everywhere. The plan row's boxes and the passage screen's boxes
 * are the same claim about the same card, and two implementations of it would
 * drift the first time one of them was adjusted.
 *
 * Everything returns a detached element. Nothing here reads state, schedules
 * work, or touches the worker.
 *
 * ## Toolbar styling
 *
 * The host gives extension panels colour and font tokens only - no button,
 * toolbar or back-icon styles (see `styles.css`'s header note). Task 0004
 * asked this panel to look like the rest of the app in the meantime: a
 * full-width toolbar band, a plain back arrow at the left, and small flat
 * buttons rather than v0's rounded filled ones and text-link "Back to plan".
 * `breadcrumb()` and `.sm-crumb*` in `styles.css` are that local approximation.
 * The proper fix is a shared stylesheet from the host (`ext-ui://host/controls.css`,
 * raised as a separate Bible-repo task per that review) that this panel would
 * then consume instead of maintaining its own copy.
 */

import type { Rung, RungView } from '../core/types';
import { append, button, el, focusQuietly } from './dom';
import { MIN_VERSES_FOR_REFERENCE_ACTIVITIES } from '../core/ladder';
import {
  MASTERED_LEVEL,
  RUNG_LABEL,
  carriesDownFrom,
  clampPercent,
  countLabel,
  formatDue,
  formatScore,
  inLadderOrder,
} from './format';

// ---------------------------------------------------------------------------
// Breadcrumb, menu, tabs
// ---------------------------------------------------------------------------

/** One entry in a `breadcrumb()` trail. */
export interface Crumb {
  label: string;
  /** Omitted on the final crumb - it is the current screen, not a link. */
  onClick?: () => void;
}

/**
 * The breadcrumb band at the top of every screen, replacing the old
 * `toolbar()`'s back arrow.
 *
 * Every non-final crumb is a real `<button>`; the final one is the screen's
 * own `<h1>`, given `aria-current="page"` instead of a click handler - there
 * is nowhere further to go from the current screen, and `panel.ts#render`
 * keeps focusing `main.querySelector('h1')` after every navigation without
 * needing to know that heading now lives inside a crumb trail.
 *
 * Crumb 1 is always Home - a house glyph (`icon('home')`) plus the word
 * "Home" - whether or not it is also the final crumb (the home screen itself
 * has a single, unclickable "Home" crumb).
 *
 * `menu` is a left-most slot for the hamburger (item 16, `menu()` below) -
 * the home screen's own `breadcrumb()` call is the only one that fills it,
 * with Manage Passages / Analytics / Settings folded into it instead of
 * sitting in `actions` as separate buttons the way they used to. `actions`
 * mirrors `toolbar()`'s own slot, e.g. the passage screen's "Show in Bible"
 * and answer-mode gear.
 */
export function breadcrumb(opts: {
  crumbs: Crumb[];
  menu?: HTMLElement;
  actions?: (HTMLElement | null)[];
}): HTMLElement {
  const list = el('ol', { class: 'sm-crumb-list' });

  opts.crumbs.forEach((crumb, index) => {
    const isFirst = index === 0;
    const isLast = index === opts.crumbs.length - 1;
    const content: (Node | string)[] = isFirst ? [icon('home'), crumb.label] : [crumb.label];

    const crumbEl: HTMLElement = isLast
      ? el('h1', { class: 'sm-crumb-current', attrs: { 'aria-current': 'page' } })
      : button(crumb.label, crumb.onClick ?? (() => {}), { class: 'sm-crumb', text: '' });
    append(crumbEl, content);

    list.appendChild(el('li', { class: 'sm-crumb-item' }, [crumbEl]));

    if (!isLast) {
      list.appendChild(
        el('li', { class: 'sm-crumb-sep' }, [
          el('span', { attrs: { 'aria-hidden': 'true' } }, ['›']),
        ]),
      );
    }
  });

  return el('nav', { class: 'sm-crumbs', attrs: { 'aria-label': 'Breadcrumb' } }, [
    opts.menu ?? null,
    list,
    el('div', { class: 'sm-crumbs-actions' }, opts.actions ?? []),
  ]);
}

// ---------------------------------------------------------------------------
// Hamburger menu
// ---------------------------------------------------------------------------

/** One entry in a `menu()` panel. */
export interface MenuItem {
  label: string;
  onClick: () => void;
}

/**
 * The hamburger menu that fills `breadcrumb()`'s `menu` slot on the home
 * screen (Decision 11 of the nav/chrome redesign, item 16): a trigger button
 * plus a `role="menu"` popover of `role="menuitem"` buttons, replacing the
 * separate "Analytics" / "Settings" buttons that used to sit in the
 * breadcrumb's `actions` slot - Manage Passages joins them there now that
 * there are three, not two, links off the home screen.
 *
 * The trigger is a bare hamburger glyph (`icon('menu')`) with `label` as its
 * `aria-label` rather than visible text next to it, the same "icon speaks for
 * itself" choice the passage screen's answer-mode gear already makes
 * (`.sm-icon-btn`, `passageView.ts`) - three even bars is already this app's
 * unambiguous "more" affordance (see `icon()`'s own note), and spelling it
 * out in words would be the one string in the whole breadcrumb band that
 * wraps.
 *
 * Not a native `<select>` or a `window.*` dialog (design doc, Decision 11):
 * this panel runs inside a sandboxed iframe where the host can suppress
 * modal dialogs outright, and a `<select>` cannot be given the roving
 * Up/Down behaviour or the Escape/outside-close behaviour a `role="menu"`
 * needs. `attachMenuKeys` below is the `role="menu"` analogue of
 * `attachTabKeys` above: same roving-focus idea, different ARIA pattern
 * (vertical arrows moving between `menuitem`s that are never in the page's
 * own Tab order while the menu is open, rather than horizontal arrows moving
 * a single roving tab stop).
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
    class: 'sm-btn sm-btn-quiet sm-icon-btn sm-menu-btn',
    text: '',
    attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': opts.label },
  });
  append(trigger, [icon('menu')]);

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
 * `role="menu"` analogue of `attachTabKeys` above (see `menu()`'s own note
 * for why it is not the same function). Left/Right, Home and End are a
 * tablist's own pattern, not a menu's, so they are left out here rather than
 * copied over.
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
      default:
        return;
    }

    ev.preventDefault();
    setRoving(target);
    focusQuietly(itemButtons[target] ?? null);
  });
}

// ---------------------------------------------------------------------------
// Tab strip
// ---------------------------------------------------------------------------

/**
 * The activity tab strip under the breadcrumb, on both the passage and
 * practice screens (Decision 2 of the nav/chrome redesign): `role="tablist"`
 * of `role="tab"` buttons, one per applicable activity, an underline rather
 * than a filled pill marking the selected one - "not pills" is the decision's
 * own wording, and a bottom border is the one treatment this file does not
 * already use for something else (badges are pills, `.sm-choice` is a filled
 * card).
 *
 * Generic over `T` rather than typed to `Rung` directly: both call sites pass
 * `Rung` values today, but nothing here needs to know that, and a component
 * this small gains nothing from repeating the union.
 */
export function tabs<T extends string>(opts: {
  items: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  ariaLabel?: string;
}): HTMLElement {
  const list = el('div', {
    class: 'sm-tabs',
    attrs: { role: 'tablist', ...(opts.ariaLabel !== undefined ? { 'aria-label': opts.ariaLabel } : {}) },
  });

  const tabButtons = opts.items.map((item) => {
    const isSelected = item.value === opts.selected;
    return button(item.label, () => opts.onSelect(item.value), {
      class: `sm-tab${isSelected ? ' sm-tab-selected' : ''}`,
      attrs: {
        role: 'tab',
        'aria-selected': String(isSelected),
        // Roving tabindex: only the selected tab sits in the page's own Tab
        // order, so tabbing into the strip lands on it directly rather than
        // on whichever tab happens to be first - see `attachTabKeys` below
        // for how the arrows keep this in sync as focus moves.
        tabindex: isSelected ? '0' : '-1',
      },
    });
  });

  append(list, tabButtons);
  attachTabKeys(list, tabButtons);

  return list;
}

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

/** The count of due activities on a passage, or nothing at all when none are. */
export function dueBadge(dueCount: number): HTMLElement | null {
  if (dueCount <= 0) return null;
  return el('span', {
    class: 'sm-badge sm-badge-due',
    text: String(dueCount),
    attrs: { 'aria-label': `${countLabel(dueCount, 'activity', 'activities')} due` },
  });
}

/** "Suggested" - the badge on the activity `suggestedRungFor` picked. */
export function suggestedBadge(): HTMLElement {
  return el('span', { class: 'sm-badge sm-badge-suggested', text: 'Suggested' });
}

// ---------------------------------------------------------------------------
// Level boxes
// ---------------------------------------------------------------------------

/** How many boxes an activity's level is drawn with - always five. */
export const LEVEL_MAX = 5;
/** The level at and above which a box is drawn green rather than yellow. */
const GREEN_AT = MASTERED_LEVEL;

/**
 * The five-box level indicator: grey for not-yet-reached, yellow at levels
 * 1-3, green at 4-5, and faded green when a mastered activity has come due
 * for review again - the spaced repetition schedule keeps running underneath,
 * and the fade is the only sign of it the user needs.
 */
export function levelBoxes(level: number, opts: { due?: boolean } = {}): HTMLElement {
  const boxes: HTMLElement[] = [];
  const faded = Boolean(opts.due) && level >= GREEN_AT;

  for (let i = 1; i <= LEVEL_MAX; i += 1) {
    const filled = i <= level;
    const classes = ['sm-level-box'];
    if (filled) classes.push(level >= GREEN_AT ? 'sm-level-box-green' : 'sm-level-box-yellow');
    if (filled && faded) classes.push('sm-level-box-faded');
    boxes.push(el('span', { class: classes.join(' '), attrs: { 'aria-hidden': 'true' } }));
  }

  const label =
    level === 0
      ? 'not tried yet'
      : `level ${level} of ${LEVEL_MAX}${opts.due ? ', due for review' : ''}`;

  return el(
    'span',
    { class: `sm-level-boxes${opts.due && level < GREEN_AT ? ' sm-level-boxes-due' : ''}`, attrs: { role: 'img', 'aria-label': label } },
    boxes,
  );
}

/**
 * A single word describing an activity square's status, for its title and
 * accessible label.
 */
function squareStatusWord(rv: RungView, carried: boolean): string {
  if (rv.level >= MASTERED_LEVEL) return 'well learned';
  if (carried) return 'learned via a harder activity';
  if (rv.level > 0) return 'in progress';
  return 'not started';
}

/**
 * The compact per-passage status strip for a plan row: one small square per
 * applicable activity rather than a labelled five-box strip per activity, so
 * a plan of many passages reads as a glance rather than a scroll (task 0004
 * review, point 1: "a lot more compact... a single row of squares").
 *
 * Colour follows the review's own scheme: greyed grey = not started, orange
 * = attempted but not yet mastered, green = mastered on this activity
 * itself, light green = not mastered *here* but the passage's overall
 * "well learned" status already carries down from a harder activity (see
 * `carriesDownFrom`).
 */
export function activitySquares(rungs: RungView[]): HTMLElement {
  const applicable = inLadderOrder(rungs).filter((r) => r.applicable);

  return el(
    'span',
    { class: 'sm-activity-squares', attrs: { role: 'img', 'aria-label': squaresLabel(applicable, rungs) } },
    applicable.map((rv) => {
      const carried = rv.level < MASTERED_LEVEL && carriesDownFrom(rungs, rv.rung);
      const status =
        rv.level >= MASTERED_LEVEL ? 'done' : carried ? 'carried' : rv.level > 0 ? 'partial' : 'new';
      return el('span', {
        class: `sm-activity-square sm-activity-square-${status}`,
        title: `${RUNG_LABEL[rv.rung]}: ${squareStatusWord(rv, carried)}`,
        attrs: { 'aria-hidden': 'true' },
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Icon buttons
// ---------------------------------------------------------------------------

/**
 * A button whose visible content is a glyph rather than a word, given an
 * accessible name through `aria-label` (and, for a mouse user, `title` as a
 * tooltip). Mirrors the pattern `passageView.ts`'s answer-mode gear (`⚙`)
 * already uses inline - `.sm-btn .sm-btn-quiet .sm-btn-small .sm-icon-btn` -
 * factored out here so later screens do not each re-type that class list.
 */
export function iconButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
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
 * `body`. The caller mounts `element` itself, like `menu()`/`tabs()`.
 * A header close button (`✕`), Esc, and a click on the backdrop itself all
 * close it; clicks inside the dialog do not.
 */
export function modal(opts: ModalOptions): ModalHandle {
  modalIdSeq += 1;
  const titleId = `sm-modal-title-${modalIdSeq}`;

  const closeButton = iconButton('✕', 'Close', () => closeModal());
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

  function focusableElements(): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR));
  }

  function openModal(): void {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backdrop.hidden = false;
    focusQuietly(focusableElements()[0] ?? dialog);
  }

  function closeModal(): void {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
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

// ---------------------------------------------------------------------------
// Tier pips
// ---------------------------------------------------------------------------

/**
 * Small dot-per-tier progress, e.g. for a passage-overview row: `tiers` pips,
 * `tiersPassed` of them marked passed. Colour is never the only signal - the
 * whole thing carries a text `aria-label` with the count, the way
 * `levelBoxes` does for its five boxes.
 */
export function tierPips(tiersPassed: number, tiers: number): HTMLElement {
  const pips: HTMLElement[] = [];
  for (let i = 1; i <= tiers; i += 1) {
    const passed = i <= tiersPassed;
    pips.push(
      el('span', {
        class: `sm-tier-pip${passed ? ' sm-tier-pip-passed' : ''}`,
        attrs: { 'aria-hidden': 'true' },
      }),
    );
  }
  return el(
    'span',
    {
      class: 'sm-tier-pips',
      attrs: { role: 'img', 'aria-label': `${tiersPassed} of ${countLabel(tiers, 'tier')} passed` },
    },
    pips,
  );
}

// ---------------------------------------------------------------------------
// List selector
// ---------------------------------------------------------------------------

/** One choice in `listSelector` - `'all'` for the "All lists" option. */
export interface ListSelectorOption {
  id: number | 'all';
  name: string;
}

/**
 * A `<select>`-based "All lists"/per-list picker. Deliberately minimal - T10
 * is what wires this into the home screen's header and decides how it looks
 * there; this just gets a working, accessible control in place.
 */
export function listSelector(
  options: ListSelectorOption[],
  selected: number | 'all',
  onChange: (id: number | 'all') => void,
): HTMLSelectElement {
  const select = el('select', {
    class: 'sm-select sm-list-selector',
    attrs: { 'aria-label': 'List' },
  }) as HTMLSelectElement;

  for (const opt of options) {
    const optionEl = el('option', { value: String(opt.id), text: opt.name });
    if (opt.id === selected) optionEl.selected = true;
    select.appendChild(optionEl);
  }

  select.addEventListener('change', () => {
    const match = options.find((opt) => String(opt.id) === select.value);
    if (match) onChange(match.id);
  });

  return select;
}

// ---------------------------------------------------------------------------
// Activity row
// ---------------------------------------------------------------------------

/** What one `activityRow` needs. */
export interface ActivityRowOptions {
  rung: Rung;
  /** 0-5, same scale as `levelBoxes`. */
  level: number;
  /** How many difficulty tiers this activity has. See `ladder.ts#TIERS`. */
  tiers: number;
  tiersPassed: number;
  /** Whether this activity is due now - passed through to `levelBoxes`. */
  due?: boolean;
  /** The schedule/progress slot, e.g. `scheduleLine`'s text - left blank if omitted. */
  scheduleText?: string;
  onPlay: () => void;
  /** Accessible name for the play icon. Defaults to "Practice <activity>". */
  playLabel?: string;
}

/**
 * One row of an aligned activity table: name, tier pips, level boxes, a
 * schedule/progress slot, and a play icon - in that order, as plain flex
 * children rather than a real `<table>` (matching `.sm-activity-card`'s own
 * approach elsewhere in this file). Deliberately minimal/generic: T12 builds
 * the actual passage-overview grid on top of this and owns the polish.
 */
export function activityRow(opts: ActivityRowOptions): HTMLElement {
  return el('div', { class: 'sm-activity-row' }, [
    el('span', { class: 'sm-activity-row-name', text: RUNG_LABEL[opts.rung] }),
    tierPips(opts.tiersPassed, opts.tiers),
    levelBoxes(opts.level, { due: opts.due }),
    el('span', { class: 'sm-activity-row-schedule', text: opts.scheduleText ?? '' }),
    iconButton('▶', opts.playLabel ?? `Practice ${RUNG_LABEL[opts.rung]}`, opts.onPlay),
  ]);
}

function squaresLabel(applicable: RungView[], allRungs: RungView[]): string {
  return applicable
    .map((rv) => {
      const carried = rv.level < MASTERED_LEVEL && carriesDownFrom(allRungs, rv.rung);
      return `${RUNG_LABEL[rv.rung]}: ${squareStatusWord(rv, carried)}`;
    })
    .join('; ');
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

/** "Due in 3 days · last score 82%" - the line under a passage-screen activity. */
export function scheduleLine(rung: { dueAt: number | null; lastScore: number | null; streak: number }, now: number): HTMLElement {
  const parts: string[] = [formatDue(rung.dueAt, now)];
  if (rung.lastScore !== null) parts.push(`Last score ${formatScore(rung.lastScore)}`);
  if (rung.streak > 0) parts.push(countLabel(rung.streak, 'pass', 'passes') + ' in a row');
  return el('p', { class: 'sm-schedule', text: parts.join(' · ') });
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

/**
 * A short caption naming an activity that does not apply and why.
 *
 * Non-applicable activities are shown rather than hidden. A ladder with a
 * missing step reads like a bug, and the reason a single verse cannot be
 * reordered is interesting enough to be worth one line of explanation.
 */
export function inapplicabilityNote(rung: Rung): string {
  switch (rung) {
    case 'ordering':
      return 'Putting verses in order needs more than one verse.';
    case 'refmatch':
      return `Matching a reference needs ${MIN_VERSES_FOR_REFERENCE_ACTIVITIES} verses in this list to tell references apart.`;
    case 'refprovide':
      return `Naming a reference needs ${MIN_VERSES_FOR_REFERENCE_ACTIVITIES} verses in this list to tell references apart.`;
    default:
      return 'This activity does not apply to this passage.';
  }
}
