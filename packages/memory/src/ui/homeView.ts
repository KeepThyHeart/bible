/**
 * Home: the landing tab. One progress tile per list (ring, learned / review status, and a
 * Practice button for just that list), then a compact practice card for the Practice focus.
 * First open shows the add form and the starter sets instead.
 *
 * Returns the screen content only: the app shell draws the page h1 and the tab
 * bar, so the focus target here is an h2 (visually hidden: the tab names it).
 */

import type { AddVersesOutcome } from '../core/api';
import type { ListSummary, PassageView, PlanView } from '../core/types';
import { listStatus } from '../core/listStatus';
import { anywayOrder, todayQueue } from '../core/today';
import type { TodayQueue } from '../core/today';
import { renderAddAndStart } from './addAndStart';
import { button, el } from './dom';
import { calendarDaysBetween, formatShortDate } from './format';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { progressTile, progressTiles } from './progressTile';
import type { ProgressTileTone } from './progressTile';
import type { Flow } from './state';
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
 * @param all     the plan scoped to all lists (the list tiles)
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
  const tiles = renderListTiles(host, all, extras);
  if (tiles) root.appendChild(tiles);
  root.appendChild(renderPracticeCard(host, all, focused, extras));
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

function runFlow(host: PanelHost, flow: Flow, btn: HTMLButtonElement): void {
  btn.disabled = true;
  void host.startFlow(flow).finally(() => {
    btn.disabled = false;
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
    const startBtn = button(startLabel, () => runFlow(host, { kind: 'today', skipped: [] }, startBtn), {
      class: 'sm-btn sm-btn-primary sm-home-start',
    });
    card.appendChild(el('div', { class: 'sm-home-practice-actions' }, [startBtn]));
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
    // "Practice more": due reviews, then verses still being learned, then new ones. Hidden once
    // only learned verses that are not yet due remain (all caught up).
    if (anywayOrder(focused.passages, now, new Set()).length > 0) {
      const more = button(tr('memory.ui.today.practiceMore', 'Practice more'), () => runFlow(host, { kind: 'anyway', visited: [] }, more), {
        class: 'sm-btn sm-home-more',
      });
      card.appendChild(el('div', { class: 'sm-home-practice-actions' }, [more]));
    }
  }

  if (focused.scope !== 'all') {
    const name = all.lists.find((l) => l.id === focused.scope)?.name ?? focused.collectionName;
    card.appendChild(el('p', { class: 'sm-home-focus-note', text: tr('memory.ui.home.practicingFrom', 'Practicing from {name}', { name }) }));
  }
  return card;
}

// ---------------------------------------------------------------------------
// List tiles
// ---------------------------------------------------------------------------

function renderListTiles(host: PanelHost, all: PlanView, extras: HomeExtras): HTMLElement | null {
  if (all.lists.length === 0) return null;
  const tiles = all.lists.map((list) =>
    renderListTile(host, list, all.passages.filter((pv) => pv.passage.collectionId === list.id), all.focus === list.id, extras),
  );
  return progressTiles(tr('memory.ui.home.listsTitle', 'Lists'), tiles, 'sm-home-tiles');
}

/** "Learned · next review …" for a learned list with nothing due. */
function learnedStatus(nextReviewAt: number | null, now: number): string {
  if (nextReviewAt === null) return tr('memory.ui.home.listLearned', 'Learned');
  const days = calendarDaysBetween(now, nextReviewAt);
  if (days <= 0) return tr('memory.ui.home.listLearnedToday', 'Learned · next review later today');
  return tr('memory.ui.home.listLearnedNext', '{days, plural, one {Learned · next review tomorrow} other {Learned · next review in # days}}', { days });
}

function renderListTile(host: PanelHost, list: ListSummary, passages: readonly PassageView[], isFocus: boolean, extras: HomeExtras): HTMLLIElement {
  const now = host.now();
  const st = listStatus(passages, now);
  const learned = st.state === 'learned';

  let status: string;
  let tone: ProgressTileTone = 'muted';
  if (st.state === 'empty') {
    status = tr('memory.ui.home.listNoVerses', 'No verses yet');
  } else if (learned && st.dueCount > 0) {
    status = tr('memory.ui.home.listLearnedDue', '{count, plural, one {Learned · # due for review} other {Learned · # due for review}}', { count: st.dueCount });
    tone = 'warning';
  } else if (learned) {
    status = learnedStatus(st.nextReviewAt, now);
    tone = 'success';
  } else {
    const progress = tr('memory.ui.home.listLearning', '{learned} of {verses, plural, one {# verse} other {# verses}} learned', {
      learned: st.versesLearned,
      verses: st.verses,
    });
    status = st.dueCount > 0
      ? tr('memory.ui.home.listLearningDue', '{progress} · {count} due', { progress, count: st.dueCount })
      : progress;
  }

  // Practice just this list (the Practice focus is left alone): today's items first, else the
  // "Practice more" order, which never offers a learned verse before its review is due.
  const queueOpts = extras.startedToday !== undefined ? { startedToday: extras.startedToday } : {};
  const flow: Flow | null = todayQueue(passages, now, queueOpts).items.length > 0
    ? { kind: 'today', skipped: [], list: list.id }
    : anywayOrder(passages, now, new Set()).length > 0
      ? { kind: 'anyway', visited: [], list: list.id }
      : null;
  let action: HTMLButtonElement | null = null;
  if (flow) {
    const review = learned && st.dueCount > 0;
    action = button(
      review ? tr('memory.ui.home.listReview', 'Review') : tr('memory.ui.home.listPractice', 'Practice'),
      () => runFlow(host, flow, action!),
      {
        class: `kth-btn kth-btn--sm${review ? ' kth-btn--primary' : ''} sm-home-tile-practice`,
        attrs: {
          'aria-label': review
            ? tr('memory.ui.home.listReviewAria', 'Review {name}', { name: list.name })
            : tr('memory.ui.home.listPracticeAria', 'Practice {name}', { name: list.name }),
        },
      },
    );
  }

  return progressTile({
    value: st.percent,
    ringLabel: tr('memory.ui.home.listRingLabel', '{name}: progress', { name: list.name }),
    ringTone: learned ? 'success' : 'accent',
    title: list.name,
    onTitleClick: () => host.go({ type: 'goVerses', list: list.id }),
    badge: isFocus ? el('span', { class: 'sm-home-tag', text: tr('memory.ui.lists.focusTag', 'Practice focus') }) : null,
    status,
    statusTone: tone,
    actions: [action],
    className: `sm-home-tile${isFocus ? ' sm-home-tile-focus' : ''}`,
  });
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
