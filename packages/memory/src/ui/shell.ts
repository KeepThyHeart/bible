/**
 * The app shell: the tab bar (Today, My verses, Progress) with the settings
 * gear, and the focus chip. Also the header of the focused screens (practice,
 * verse page, reminder cards, recite), which have a close button and no tabs.
 *
 * The tab bar is a real `tablist`: arrows move focus (`attachTabKeys`), Enter or
 * a click selects, and only the selected tab is in the page's Tab order.
 */

import type { PlanView } from '../core/types';
import { append, button, el } from './dom';
import { attachTabKeys } from './components';
import type { PanelHost } from './host';
import { setFocus } from './listActions';
import { tr } from './i18n';
import type { Tab } from './state';
import './styles/shell.css';

const TABS: readonly Tab[] = ['today', 'verses', 'progress'];

export const TAB_PANEL_ID = 'sm-tabpanel';
export const tabId = (tab: Tab): string => `sm-tab-${tab}`;

function tabLabel(tab: Tab): string {
  switch (tab) {
    case 'today':
      return tr('memory.ui.shell.tabToday', 'Today');
    case 'verses':
      return tr('memory.ui.shell.tabVerses', 'My verses');
    default:
      return tr('memory.ui.shell.tabProgress', 'Progress');
  }
}

/** The name of the list the focus is on, for the chip. */
function focusName(plan: PlanView): string {
  if (plan.scope === 'all') return '';
  return plan.lists.find((l) => l.id === plan.scope)?.name ?? plan.collectionName;
}

/**
 * Wraps a tab view (or settings) in the tab bar. `tab` is `'settings'` when the
 * gear's screen is showing: no tab is selected then and the gear is `aria-current`.
 * `plan` feeds the focus chip (Today and My verses only); pass null to omit it.
 */
export function appShell(host: PanelHost, tab: Tab | 'settings', plan: PlanView | null, content: HTMLElement): HTMLElement {
  const onSettings = tab === 'settings';

  const tabButtons = TABS.map((t, i) => {
    const selected = t === tab;
    return button(
      tabLabel(t),
      () => host.go({ type: 'goTab', tab: t }),
      {
        id: tabId(t),
        class: 'sm-shell-tab',
        attrs: {
          role: 'tab',
          'aria-selected': String(selected),
          'aria-controls': TAB_PANEL_ID,
          // Roving tabindex; with no tab selected (settings) the first one is the stop.
          tabindex: selected || (onSettings && i === 0) ? '0' : '-1',
        },
      },
    );
  });
  const list = el('div', {
    class: 'sm-shell-tabs',
    attrs: { role: 'tablist', 'aria-label': tr('memory.ui.shell.tabsLabel', 'Memory') },
  });
  append(list, tabButtons);
  attachTabKeys(list, tabButtons);

  const gearLabel = tr('memory.ui.shell.settings', 'Settings');
  const gear = button('⚙', () => host.go({ type: 'goSettings' }), {
    class: 'sm-shell-gear',
    title: gearLabel,
    attrs: { 'aria-label': gearLabel, ...(onSettings ? { 'aria-current': 'page' } : {}) },
  });

  const panel = el(
    'div',
    {
      id: TAB_PANEL_ID,
      class: 'sm-shell-panel',
      attrs: {
        role: 'tabpanel',
        ...(onSettings ? { 'aria-label': gearLabel } : { 'aria-labelledby': tabId(tab as Tab) }),
      },
    },
    [content],
  );

  const showChip = plan !== null && plan.scope !== 'all' && (tab === 'today' || tab === 'verses');
  let chip: HTMLElement | null = null;
  if (showChip && plan !== null) {
    const clearLabel = tr('memory.ui.shell.clearFocus', 'Clear focus');
    chip = el('div', { class: 'sm-shell-chip' }, [
      el('span', { text: tr('memory.ui.shell.focusChip', 'Focus: {name}', { name: focusName(plan) }) }),
      button('×', () => void setFocus(host, null), { class: 'sm-shell-chip-clear', title: clearLabel, attrs: { 'aria-label': clearLabel } }),
    ]);
  }

  return el('div', { class: 'sm-shell' }, [
    el('div', { class: 'sm-shell-bar' }, [list, gear]),
    chip,
    panel,
  ]);
}

/**
 * Header of a focused screen: a close button, the title (the screen's h1, which
 * receives focus on arrival), and optional meta text and "..." menu.
 */
export function focusedHeader(opts: {
  title: string;
  onClose: () => void;
  closeLabel?: string;
  menu?: HTMLElement;
  meta?: HTMLElement;
}): HTMLElement {
  const closeLabel = opts.closeLabel ?? tr('memory.ui.shell.close', 'Close');
  return el('header', { class: 'sm-focused-head' }, [
    button('×', opts.onClose, {
      class: 'sm-btn sm-btn-quiet sm-btn-small sm-focused-close',
      title: closeLabel,
      attrs: { 'aria-label': closeLabel },
    }),
    el('h1', { class: 'sm-screen-title sm-focused-title', text: opts.title }),
    opts.meta ? el('div', { class: 'sm-focused-meta' }, [opts.meta]) : null,
    opts.menu ?? null,
  ]);
}
