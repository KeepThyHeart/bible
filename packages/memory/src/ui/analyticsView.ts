/**
 * Analytics: numbers picked to be encouraging, not exhaustive.
 *
 * This replaced "Progress" in the task 0004 review, which asked for the
 * screen to be "limited to the analytics likely to incite excitement for
 * studying the passages." "Rungs mastered" and "where the effort went" were
 * dropped for exactly that reason - they describe the mechanism, not the
 * achievement. What is here instead: a streak, a running total of verses
 * genuinely learned, a practice calendar, recent level-ups and the next round
 * number to reach.
 *
 * Still no chart library, for the same reason v0 had none: `default-src
 * 'none'` with `connect-src 'self'` means nothing loads from anywhere, and a
 * handful of `<div>`s with a width are not worth bundling one for.
 *
 * `versesLearned` and `passagesWellLearned` are not this file's numbers to
 * define - they come from `store.ts#analytics`, which already applies T4's
 * `ladder.ts#passageWellLearned` (every applicable activity satisfied, not
 * `bestLevel >= 4`) and already scopes the whole query to
 * `store.ts#getScope()` - the same list-or-all scope the plan screen's
 * picker drives (`types.ts#Scope`). There is nothing for this view to filter
 * a second time; switching lists on the plan screen and coming back here
 * shows this screen's numbers for that scope automatically.
 */

import type { AnalyticsView } from '../core/types';
import { breadcrumb, emptyState, statTile } from './components';
import { button, el } from './dom';
import { RUNG_LABEL, calendarWeeks, formatShortDate, weekdayLabel } from './format';
import type { PanelHost } from './host';
import { tr } from './i18n';

export function renderAnalytics(host: PanelHost, analytics: AnalyticsView): HTMLElement {
  const root = el('section', { class: 'sm-screen sm-screen-analytics' });

  root.appendChild(
    breadcrumb({ crumbs: [{ label: tr('memory.ui.plan.home', 'Home'), onClick: () => host.go({ type: 'goPlan' }) }, { label: tr('memory.ui.plan.analytics', 'Analytics') }] }),
  );

  if (analytics.passagesWellLearned === 0 && analytics.streakDays === 0) {
    root.appendChild(
      emptyState(
        tr('memory.ui.plan.nothingToShowYet', 'Nothing to show yet.'),
        tr('memory.ui.plan.nothingToShowHint', 'Practice a passage a few times and this screen fills in from there.'),
        button(tr('memory.ui.plan.backToPlan', 'Back to plan'), () => host.go({ type: 'goPlan' }), { class: 'sm-btn' }),
      ),
    );
    return root;
  }

  root.appendChild(
    el('div', { class: 'sm-stats' }, [
      statTile(String(analytics.streakDays), tr('memory.ui.plan.daysInARow', '{count, plural, one {# day in a row} other {# days in a row}}', { count: analytics.streakDays })),
      statTile(String(analytics.versesLearned), tr('memory.ui.plan.versesLearnedLabel', 'verses learned')),
      statTile(
        String(analytics.passagesWellLearned),
        tr('memory.ui.plan.passagesWellLearned', '{count, plural, one {# passage well learned} other {# passages well learned}}', { count: analytics.passagesWellLearned }),
      ),
    ]),
  );

  root.appendChild(renderCalendar(analytics, host.now()));
  root.appendChild(renderRecentlyReached(analytics, host.now()));
  root.appendChild(renderMilestone(analytics));

  return root;
}

function renderCalendar(analytics: AnalyticsView, now: number): HTMLElement {
  const weeks = calendarWeeks(analytics);
  const headings = weeks[0]?.map((day) => weekdayLabel(day.date)) ?? [];

  return el('section', { class: 'sm-block' }, [
    el('h2', { class: 'sm-block-title', text: tr('memory.ui.plan.lastFiveWeeks', 'Last five weeks') }),
    el(
      'div',
      { class: 'sm-calendar', attrs: { role: 'img', 'aria-label': calendarSummary(analytics) } },
      [
        el(
          'div',
          { class: 'sm-calendar-row sm-calendar-headings' },
          headings.map((h) => el('span', { class: 'sm-calendar-heading', text: h })),
        ),
        ...weeks.map((week) =>
          el(
            'div',
            { class: 'sm-calendar-row' },
            week.map((day) =>
              el('span', {
                class: `sm-calendar-cell${day.practiced ? ' sm-calendar-cell-on' : ''}${isToday(day.date, now) ? ' sm-calendar-cell-today' : ''}`,
                title: formatShortDate(day.date, now),
              }),
            ),
          ),
        ),
      ],
    ),
  ]);
}

function isToday(dateMs: number, now: number): boolean {
  const a = new Date(dateMs);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function calendarSummary(analytics: AnalyticsView): string {
  const practiced = analytics.calendar.filter((d) => d.practiced).length;
  return tr('memory.ui.plan.practicedOnDays', 'Practiced on {count, plural, one {# day} other {# days}} of the last 35.', { count: practiced });
}

function renderRecentlyReached(analytics: AnalyticsView, now: number): HTMLElement {
  return el('section', { class: 'sm-block' }, [
    el('h2', { class: 'sm-block-title', text: tr('memory.ui.plan.recentlyReached', 'Recently reached') }),
    analytics.recentlyReached.length === 0
      ? el('p', { class: 'sm-block-caption', text: tr('memory.ui.plan.nothingAtLevel4', 'Nothing at level 4 or above yet.') })
      : el(
          'ul',
          { class: 'sm-milestones' },
          analytics.recentlyReached.map((m) =>
            el('li', { class: 'sm-milestone-row' }, [
              el('span', { class: 'sm-milestone-ref', text: m.reference }),
              el('span', { class: 'sm-milestone-rung', text: tr('memory.ui.plan.rungLevel', '{rung} {level}/5', { rung: RUNG_LABEL[m.rung], level: m.level }) }),
              el('span', { class: 'sm-milestone-date', text: formatShortDate(m.at, now) }),
            ]),
          ),
        ),
  ]);
}

function renderMilestone(analytics: AnalyticsView): HTMLElement {
  const { versesLearned, toGo } = analytics.nextMilestone;
  return el('p', {
    class: 'sm-block-caption',
    text:
      toGo <= 0
        ? tr('memory.ui.plan.milestoneReached', '{count} verses learned - milestone reached.', { count: versesLearned })
        : tr('memory.ui.plan.nextMilestone', 'Next milestone: {count} verses learned ({toGo} to go).', { count: versesLearned, toGo }),
  });
}
