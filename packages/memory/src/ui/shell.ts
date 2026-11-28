/**
 * The app shell: the same frame as `@bible/ui` `AppPage` (title row, tab bar, tab panel), built from the
 * shared `.kth-app-page*` / `.kth-tabs*` classes so Memory lines up with the other apps (start edge,
 * reading-width cap). Tabs: Home, Practice, My verses, Settings. The shell is built once per mount and
 * stays put; every screen, practice and recite included, is drawn inside its panel, so the tab bar never
 * goes away and the panel's scroll position survives a redraw of the same screen.
 *
 * The tab bar is a real `tablist`: arrows move focus (`attachTabKeys`), Enter or a click selects, and only
 * the selected tab is in the page's Tab order. Also the header of opened screens (practice, verse page,
 * reminder cards, recite): a close button and the screen's h2.
 */

import type { PlanView } from '../core/types';
import { append, button, clear, el } from './dom';
import { attachTabKeys } from './components';
import type { PanelHost } from './host';
import { setFocus } from './listActions';
import { tr } from './i18n';
import type { Tab } from './state';
import './styles/shell.css';

export const TABS: readonly Tab[] = ['home', 'practice', 'verses', 'settings'];

export const TAB_PANEL_ID = 'sm-tabpanel';
export const tabId = (tab: Tab): string => `sm-tab-${tab}`;

export function tabLabel(tab: Tab): string {
  switch (tab) {
    case 'home':
      return tr('memory.ui.shell.tabHome', 'Home');
    case 'practice':
      return tr('memory.ui.shell.tabPractice', 'Practice');
    case 'verses':
      return tr('memory.ui.shell.tabVerses', 'My verses');
    default:
      return tr('memory.ui.shell.tabSettings', 'Settings');
  }
}

/** A button the host puts at the end of the title row (desktop: "Back to Study"). */
export interface ShellAction {
  label: string;
  onClick(): void;
}

export interface ShellOptions {
  /** The page heading; default "Memory". */
  title?: string;
  actions?: readonly ShellAction[];
}

export interface Shell {
  /** `div.kth-app-page`: the scroller. */
  readonly root: HTMLElement;
  /** The tab panel every screen is drawn into. */
  readonly panel: HTMLElement;
  /** Selects `tab` (aria-selected, roving tabindex, the panel's label). */
  setTab(tab: Tab): void;
  /** The focus chip above the panel (the Practice focus); null removes it. */
  setChip(plan: PlanView | null): void;
  /** Replaces the panel's content; null leaves it empty and `aria-busy` (data still loading). */
  setContent(content: HTMLElement | null): void;
}

/** The name of the list the focus is on, for the chip. */
function focusName(plan: PlanView): string {
  if (plan.scope === 'all') return '';
  return plan.lists.find((l) => l.id === plan.scope)?.name ?? plan.collectionName;
}

export function createShell(host: PanelHost, options: ShellOptions = {}): Shell {
  let current: Tab = 'home';
  const tabButtons = TABS.map((t) =>
    button(tabLabel(t), () => host.go({ type: 'goTab', tab: t }), {
      id: tabId(t),
      class: 'kth-tabs__tab sm-shell-tab',
      attrs: { role: 'tab', 'aria-selected': 'false', 'aria-controls': TAB_PANEL_ID, tabindex: '-1' },
    }),
  );
  const list = el('div', {
    class: 'kth-tabs kth-app-page__tabs sm-shell-tabs',
    attrs: { role: 'tablist', 'aria-label': tr('memory.ui.shell.tabsLabel', 'Memory') },
  });
  append(list, tabButtons);
  attachTabKeys(list, tabButtons);

  const title = options.title ?? tr('memory.ui.shell.title', 'Memory');
  const actions = options.actions && options.actions.length > 0
    ? el('div', { class: 'kth-app-page__actions' }, options.actions.map((a) => button(a.label, () => a.onClick(), { class: 'kth-btn' })))
    : null;

  const panel = el('div', { id: TAB_PANEL_ID, class: 'kth-app-page__body sm-shell-panel', attrs: { role: 'tabpanel' } });
  const chipSlot = el('div', { class: 'sm-shell-chip-slot' });

  const root = el('div', { class: 'kth-app-page kth-app-page--sticky-tabs sm-shell' }, [
    el('div', { class: 'kth-app-page__column' }, [
      el('div', { class: 'kth-app-page__header' }, [
        // tabindex -1: the host moves focus here when the app opens.
        el('h1', { class: 'kth-app-page__title', text: title, attrs: { tabindex: '-1' } }),
        actions,
      ]),
      list,
      chipSlot,
      panel,
    ]),
  ]);

  function setTab(tab: Tab): void {
    current = tab;
    tabButtons.forEach((b, i) => {
      const on = TABS[i] === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tabId(tab));
  }

  function setChip(plan: PlanView | null): void {
    clear(chipSlot);
    if (plan === null || plan.scope === 'all') return;
    const clearLabel = tr('memory.ui.shell.clearFocus', 'Clear focus');
    chipSlot.appendChild(
      el('div', { class: 'sm-shell-chip' }, [
        el('span', { text: tr('memory.ui.shell.focusChip', 'Focus: {name}', { name: focusName(plan) }) }),
        button('×', () => void setFocus(host, null), { class: 'sm-shell-chip-clear', title: clearLabel, attrs: { 'aria-label': clearLabel } }),
      ]),
    );
  }

  function setContent(content: HTMLElement | null): void {
    clear(panel);
    if (content === null) panel.setAttribute('aria-busy', 'true');
    else {
      panel.removeAttribute('aria-busy');
      panel.appendChild(content);
    }
  }

  setTab(current);
  return { root, panel, setTab, setChip, setContent };
}

/**
 * Header of an opened screen: a close button, the title (the screen's h2, which
 * receives focus on arrival), and optional meta text and "..." menu.
 */
export function focusedHeader(opts: {
  title: string;
  /** Omit for a screen with its own back button (the verse page): no close button. */
  onClose?: () => void;
  closeLabel?: string;
  menu?: HTMLElement;
  meta?: HTMLElement;
}): HTMLElement {
  const closeLabel = opts.closeLabel ?? tr('memory.ui.shell.close', 'Close');
  return el('header', { class: 'sm-focused-head' }, [
    opts.onClose
      ? button('×', opts.onClose, {
          class: 'sm-btn sm-btn-quiet sm-btn-small sm-focused-close',
          title: closeLabel,
          attrs: { 'aria-label': closeLabel },
        })
      : null,
    el('h2', { class: 'sm-screen-title sm-focused-title', text: opts.title, attrs: { tabindex: '-1' } }),
    opts.meta ? el('div', { class: 'sm-focused-meta' }, [opts.meta]) : null,
    opts.menu ?? null,
  ]);
}
