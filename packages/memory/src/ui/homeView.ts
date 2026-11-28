/**
 * Home: the landing tab. A compact practice card, overall progress, and one
 * card per list with its percent complete. First open shows the add form and
 * the starter sets instead.
 *
 * Returns the screen content only: the app shell draws the page h1 and the tab
 * bar, so the focus target here is an h2 (visually hidden: the tab names it).
 */

import type { AddVersesOutcome } from '../core/api';
import type { ListSummary, PassageView, PlanView } from '../core/types';
import { overallProgress } from '../core/progress';
import { todayQueue } from '../core/today';
import type { TodayQueue } from '../core/today';
import { renderAddAndStart } from './addAndStart';
import { button, el } from './dom';
import { calendarDaysBetween, formatShortDate } from './format';
import type { PanelHost } from './host';
import { tr } from './i18n';
import './styles/home.css';

export interface HomeExtras {
  /** A verse just added from the Bible (same as `TodayExtras.justAdded`). */
  justAdded?: { passageId: number; reference: string; outcome?: AddVersesOutcome } | null;
  /** Reminder cards waiting to be answered. */
  reminders?: { waiting: number } | null;
  /** Verses started today across all lists (the new-verse cap is global). */
  startedToday?: number;
}

/**
 * @param all     the plan scoped to all lists (progress and list cards)
 * @param focused the plan scoped to the Practice focus (the practice card)
 */
export function renderHome(host: PanelHost, all: PlanView, focused: PlanView, extras: HomeExtras = {}): HTMLElement {
  const root = el('section', { class: 'sm-screen sm-home' });

  const offer = renderOfferRow(host, extras.justAdded ?? null);
  if (offer) root.appendChild(offer);
  const reminders = renderRemindersRow(host, extras.reminders?.waiting ?? 0);
  if (reminders) root.appendChild(reminders);

  if (all.passages.length === 0) {
    root.appendChild(renderFirstOpen(host));
    return root;
  }

  // tabindex -1: the shell moves focus here on arrival.
  root.appendChild(
    el('h2', { class: 'sm-screen-title sm-sr-only', text: tr('memory.ui.home.title', 'Home'), attrs: { tabindex: '-1' } }),
  );
  root.appendChild(renderPracticeCard(host, all, focused, extras));
  root.appendChild(renderOverall(all.passages));
  const lists = renderLists(host, all);
  if (lists) root.appendChild(lists);
  return root;
}

// ---------------------------------------------------------------------------
// Offer and reminders rows
// ---------------------------------------------------------------------------

function renderOfferRow(host: PanelHost, added: HomeExtras['justAdded']): HTMLElement | null {
  if (!added) return null;
  const startBtn = button(
    tr('memory.ui.today.practiceNow', 'Practice now'),
    () => {
      startBtn.disabled = true;
      void host.startSession(added.passageId).finally(() => {
        startBtn.disabled = false;
      });
    },
    { class: 'sm-btn sm-btn-primary sm-btn-small' },
  );
  return el('div', { class: 'sm-home-row sm-home-offer', attrs: { role: 'status' } }, [
    el('span', { class: 'sm-home-row-text', text: offerText(added) }),
    startBtn,
  ]);
}

function offerText(added: NonNullable<HomeExtras['justAdded']>): string {
  const params = { reference: added.reference };
  switch (added.outcome) {
    case 'revived':
      return tr('memory.ui.today.justRevived', 'Restored {reference} to Memory.', params);
    case 'exists':
      return tr('memory.ui.today.alreadyAdded', '{reference} is already in Memory.', params);
    default:
      return tr('memory.ui.today.justAdded', 'Added {reference} to Memory.', params);
  }
}

function renderRemindersRow(host: PanelHost, waiting: number): HTMLElement | null {
  if (!Number.isFinite(waiting) || waiting <= 0) return null;
  const label = tr('memory.ui.today.remindersWaiting', '{count, plural, one {# reminder waiting} other {# reminders waiting}}', { count: waiting });
  return el('div', { class: 'sm-home-row sm-home-reminders' }, [
    el('span', { class: 'sm-home-row-text', text: label }),
    button(
      tr('memory.ui.today.reviewReminders', 'Review'),
      () => host.go({ type: 'goCard' }),
      {
        class: 'sm-btn sm-btn-small',
        attrs: { 'aria-label': tr('memory.ui.today.reviewRemindersAria', '{label}. Review them.', { label }) },
      },
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Practice card
// ---------------------------------------------------------------------------

function countsText(queue: TodayQueue): string {
  const review = queue.reviewCount;
  const fresh = queue.newCount;
  if (review > 0 && fresh > 0) {
    return tr('memory.ui.today.countsBoth', '{review} to review, {fresh} new', { review, fresh });
  }
  if (review > 0) return tr('memory.ui.today.countsReview', '{review} to review', { review });
  return tr('memory.ui.today.countsNew', '{fresh} new', { fresh });
}

function upcomingText(queue: TodayQueue, now: number): string | null {
  const up = queue.upcoming;
  if (!up) return null;
  if (calendarDaysBetween(now, up.day) <= 1) {
    return tr('memory.ui.today.upcomingTomorrow', '{count, plural, one {Next review tomorrow: # verse} other {Next review tomorrow: # verses}}', { count: up.count });
  }
  return tr('memory.ui.today.upcomingOn', '{count, plural, one {Next review {date}: # verse} other {Next review {date}: # verses}}', {
    count: up.count,
    date: formatShortDate(up.day, now),
  });
}

function renderPracticeCard(host: PanelHost, all: PlanView, focused: PlanView, extras: HomeExtras): HTMLElement {
  const now = host.now();
  const queue = todayQueue(focused.passages, now, extras.startedToday !== undefined ? { startedToday: extras.startedToday } : {});
  const card = el('div', { class: 'sm-home-card sm-home-practice' });

  if (queue.items.length > 0) {
    const counts = countsText(queue);
    const line = queue.minutes > 0
      ? tr('memory.ui.home.countsAndMinutes', '{counts} · {minutes}', {
          counts,
          minutes: tr('memory.ui.today.minutes', '{minutes, plural, one {About # minute} other {About # minutes}}', { minutes: queue.minutes }),
        })
      : counts;
    card.appendChild(el('p', { class: 'sm-home-practice-line', text: line }));

    const startLabel = queue.doneToday > 0
      ? tr('memory.ui.today.continue', 'Continue')
      : tr('memory.ui.home.startPracticing', 'Start practicing');
    const startBtn = button(startLabel, () => {
      startBtn.disabled = true;
      void host.startFlow({ kind: 'today', skipped: [] }).finally(() => {
        startBtn.disabled = false;
      });
    }, { class: 'sm-btn sm-btn-primary sm-home-start' });
    card.appendChild(
      el('div', { class: 'sm-home-practice-actions' }, [
        startBtn,
        button(tr('memory.ui.home.seeNext', "See what's next"), () => host.go({ type: 'goTab', tab: 'practice' }), {
          class: 'sm-btn sm-btn-quiet sm-home-next-link',
        }),
      ]),
    );
  } else {
    card.classList.add('sm-home-practice-done');
    card.appendChild(
      el('p', { class: 'sm-home-done-title' }, [
        el('span', { class: 'sm-home-check', text: '✓', attrs: { 'aria-hidden': 'true' } }),
        el('span', { text: tr('memory.ui.today.doneTitle', 'Done for today') }),
      ]),
    );
    const upcoming = upcomingText(queue, now);
    if (upcoming) card.appendChild(el('p', { class: 'sm-home-meta', text: upcoming }));
    const streak = focused.streakDays ?? 0;
    if (streak > 0) {
      card.appendChild(el('p', {
        class: 'sm-home-meta sm-home-streak',
        text: tr('memory.ui.today.streak', '{count, plural, one {# day streak} other {# day streak}}', { count: streak }),
      }));
    }
    card.appendChild(
      button(tr('memory.ui.home.seeNext', "See what's next"), () => host.go({ type: 'goTab', tab: 'practice' }), {
        class: 'sm-btn sm-btn-quiet sm-home-next-link',
      }),
    );
  }

  if (focused.scope !== 'all') {
    const name = all.lists.find((l) => l.id === focused.scope)?.name ?? focused.collectionName;
    card.appendChild(el('p', { class: 'sm-home-focus-note', text: tr('memory.ui.home.practicingFrom', 'Practicing from {name}', { name }) }));
  }
  return card;
}

// ---------------------------------------------------------------------------
// Overall progress and list cards
// ---------------------------------------------------------------------------

function progressBar(percent: number, name: string, valueText: string, extraClass = ''): HTMLElement {
  return el(
    'div',
    {
      class: `sm-bar sm-home-bar${extraClass ? ` ${extraClass}` : ''}`,
      attrs: {
        role: 'progressbar',
        'aria-label': name,
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(percent),
        'aria-valuetext': valueText,
      },
    },
    [el('div', { class: 'sm-bar-fill sm-home-bar-fill', style: { inlineSize: `${percent}%` } })],
  );
}

function renderOverall(passages: readonly PassageView[]): HTMLElement {
  const p = overallProgress(passages);
  const name = tr('memory.ui.verses.progressName', 'Overall progress');
  const label = tr('memory.ui.verses.progressActivities', '{percent}% of activities complete · {learned} of {verses} verses learned', {
    percent: p.percent,
    learned: p.versesLearned,
    verses: p.verses,
  });
  return el('section', { class: 'sm-home-overall' }, [
    el('h3', { class: 'sm-home-section-title', text: name }),
    progressBar(p.percent, name, label, 'sm-home-bar-overall'),
    el('p', { class: 'sm-home-overall-text', text: label }),
  ]);
}

function renderLists(host: PanelHost, all: PlanView): HTMLElement | null {
  if (all.lists.length === 0) return null;
  const grid = el('ul', { class: 'sm-home-lists' });
  for (const list of all.lists) {
    const passages = all.passages.filter((pv) => pv.passage.collectionId === list.id);
    grid.appendChild(el('li', { class: 'sm-home-list-item' }, [renderListCard(host, list, passages, all.focus === list.id)]));
  }
  return el('section', { class: 'sm-home-lists-section' }, [
    el('h3', { class: 'sm-home-section-title', text: tr('memory.ui.home.listsTitle', 'Lists') }),
    grid,
  ]);
}

function renderListCard(host: PanelHost, list: ListSummary, passages: readonly PassageView[], isFocus: boolean): HTMLElement {
  const p = overallProgress(passages);
  const empty = passages.length === 0;
  const countText = empty
    ? tr('memory.ui.home.listNoVerses', 'No verses yet')
    : tr('memory.ui.home.listVerses', '{count, plural, one {# verse} other {# verses}}', { count: passages.length });
  const percentText = tr('memory.ui.home.listPercent', '{percent}% complete', { percent: p.percent });
  const tagText = tr('memory.ui.lists.focusTag', 'Practice focus');

  const label = empty
    ? tr('memory.ui.home.listCardEmpty', '{name}, {count}', { name: list.name, count: countText })
    : tr('memory.ui.home.listCardLabel', '{name}, {count}, {percent}', { name: list.name, count: countText, percent: percentText });
  const card = el(
    'button',
    {
      class: `sm-home-card sm-home-list${isFocus ? ' sm-home-list-focus' : ''}${empty ? ' sm-home-list-empty' : ''}`,
      attrs: { type: 'button', 'aria-label': isFocus ? tr('memory.ui.home.listCardFocus', '{label}, {tag}', { label, tag: tagText }) : label },
    },
    [
      el('span', { class: 'sm-home-list-head' }, [
        el('span', { class: 'sm-home-list-name', text: list.name }),
        isFocus ? el('span', { class: 'sm-home-tag', text: tagText }) : null,
      ]),
      el('span', { class: 'sm-home-list-count', text: countText }),
      empty
        ? null
        : el('span', { class: 'sm-home-list-progress', attrs: { 'aria-hidden': 'true' } }, [
            el('span', { class: 'sm-bar sm-home-bar' }, [
              el('span', { class: 'sm-bar-fill sm-home-bar-fill', style: { inlineSize: `${p.percent}%` } }),
            ]),
            el('span', { class: 'sm-home-list-percent', text: percentText }),
          ]),
    ],
  ) as HTMLButtonElement;
  card.addEventListener('click', () => host.go({ type: 'goVerses', list: list.id }));
  return card;
}

// ---------------------------------------------------------------------------
// First open
// ---------------------------------------------------------------------------

function renderFirstOpen(host: PanelHost): HTMLElement {
  return el('div', { class: 'sm-home-first' }, [
    el('h2', { class: 'sm-screen-title sm-home-welcome', text: tr('memory.ui.today.welcomeTitle', 'Learn Scripture by heart'), attrs: { tabindex: '-1' } }),
    renderAddAndStart(host),
    el('div', { class: 'sm-home-first-actions' }, [
      button(tr('memory.ui.lists.browseStarters', 'Browse starter sets'), () => host.go({ type: 'goStarters' }), { class: 'sm-btn' }),
    ]),
    el('p', {
      class: 'sm-hint sm-home-tip',
      text: tr('memory.ui.today.memorizeTip', 'Or right-click any verse in the Bible and choose Memorize.'),
    }),
  ]);
}
