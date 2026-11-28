/**
 * The Agenda tab of the Reading plans app: what to read and how each plan stands.
 *
 * - One small tile per active plan: a progress ring, the plan (opens it) and how it stands. Overall progress only;
 *   what to read is below.
 * - One line per fixed plan that has fallen behind, with Reschedule.
 * - The readings themselves as a List (from the earliest unread date, at most a week back, to a week ahead), a Week
 *   (one column per day) or a Month (a calendar with the chosen date's readings beside it).
 *
 * Every view is drawn from core's `agenda()` over all the plans, so they always agree.
 */
import React, { useMemo, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Checkbox, Notice, ProgressTile, ProgressTiles, ReadingPlanMonthCalendar, SegmentedControl } from '@bible/ui';
import { useI18n } from '../../../contexts/useI18n';
import { rpTextWith } from '../rpText';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';
import { shownPercent } from './readingPlanData';
import { usePreferencesStore, type ReadingPlanAgendaView } from '../../../stores/usePreferencesStore';

export interface AgendaPlan {
  detail: ReadingPlans.EnrollmentDetail;
  completions: readonly ReadingPlans.Completion[];
  progress: ReadingPlans.ProgressIndex;
  displayName: string;
}

export interface ReadingTarget { day: number; index: number; reading: ReadingPlans.Reading }

export interface AgendaTabProps {
  plans: readonly AgendaPlan[];
  labels: ReadingPlanLabelSet;
  todayDate: string;
  rolloverHour: number;
  weekStart: 0 | 1;
  onToggleReading: (enrollmentId: string, day: number, index: number, done: boolean) => void;
  onToggleDay: (enrollmentId: string, day: number, done: boolean) => void;
  onOpenReading: (enrollmentId: string, target: ReadingTarget) => void;
  /** Open the plan in the Plans tab. */
  onViewPlan: (enrollmentId: string) => void;
  onReschedule: (enrollmentId: string) => void;
}

type AgendaView = ReadingPlanAgendaView;
/** The list runs this many days past today. */
const LIST_AHEAD_DAYS = 6;

const monthOf = (date: string) => date.slice(0, 7);
function addMonths(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

const AgendaTab: React.FC<AgendaTabProps> = ({
  plans, labels, todayDate, rolloverHour, weekStart, onToggleReading, onToggleDay, onOpenReading, onViewPlan,
  onReschedule,
}) => {
  const { t } = useI18n();
  const tx = (key: string, fallback: string, params: Record<string, unknown> = {}) => rpTextWith(t, key, fallback, params);
  const byId = useMemo(() => new Map(plans.map((p) => [p.detail.enrollment.id, p])), [plans]);
  const inputs = useMemo<ReadingPlans.AgendaInput[]>(
    () => plans.filter((p) => p.detail.enrollment.status !== 'completed')
      .map((p) => ({ plan: p.detail.plan, enrollment: p.detail.enrollment, completions: p.completions })),
    [plans],
  );
  const start = useMemo(() => ReadingPlans.agendaStartDate(inputs, todayDate, rolloverHour), [inputs, todayDate, rolloverHour]);

  // Remembered with the app's preferences: it opens on the view last chosen.
  const view = usePreferencesStore((st) => st.readingPlanAgendaView);
  const setView = usePreferencesStore((st) => st.setReadingPlanAgendaView);
  const [weekAnchor, setWeekAnchor] = useState(start);
  const [month, setMonth] = useState(monthOf(start));
  const [selectedDate, setSelectedDate] = useState<string>(start);

  const readingText = (p: AgendaPlan, r: ReadingPlans.Reading) => {
    const prefix = r.track ? `${labels.trackName(r.track, p.detail.plan.tracks?.find((x) => x.id === r.track)?.name)}: ` : '';
    return `${prefix}${labels.formatReading(r)}`;
  };
  const several = inputs.length > 1;

  // ---- The plans table --------------------------------------------------------------------------------------
  const status = (p: AgendaPlan): string => {
    const { enrollment, today } = p.detail;
    if (enrollment.status === 'paused') return t('readingPlans.status.paused');
    if (enrollment.status === 'completed' || today.completed) return t('readingPlans.status.completed');
    if (today.notStarted) return t('readingPlans.home.startsOn', { date: labels.formatDate(enrollment.startDate) });
    if (today.behindBy > 0) return t('readingPlans.today.behindChip', { n: today.behindBy });
    if (today.aheadBy > 0) return t('readingPlans.today.aheadChip', { n: today.aheadBy });
    return tx('readingPlans.agenda.onTrack', 'On track');
  };

  // One tile per active plan: a progress ring, the plan (opens it in the Plans tab) and how it stands.
  const progressTiles = () => {
    const active = plans.filter((p) => p.detail.enrollment.status === 'active' && !p.detail.today.completed);
    if (active.length === 0) return null;
    return (
      <ProgressTiles aria-label={tx('readingPlans.agenda.progress', 'Progress')} testId="agenda-progress">
        {active.map((p) => {
          const id = p.detail.enrollment.id;
          const pct = p.detail.stats.percent;
          return (
            <ProgressTile key={id} testId="agenda-plan-tile" value={pct}
              ringLabel={`${p.displayName}: ${t('readingPlans.today.progress')}`}
              valueText={labels.todayCard.percent(shownPercent(pct))}
              title={p.displayName} onTitleClick={() => onViewPlan(id)}
              status={status(p)} statusTone={p.detail.today.behindBy > 0 ? 'warning' : 'muted'} />
          );
        })}
      </ProgressTiles>
    );
  };

  const behindNotices = () => plans
    .filter((p) => p.detail.enrollment.status === 'active' && p.detail.today.behindBy > 0)
    .map((p) => {
      const n = p.detail.today.behindBy;
      return (
        <Notice key={p.detail.enrollment.id} tone="warning"
          actions={<button type="button" className="kth-btn kth-btn--sm" onClick={() => onReschedule(p.detail.enrollment.id)}>
            {tx('readingPlans.reschedule.button', 'Reschedule')}
          </button>}>
          <span data-testid="behind-line">
            {tx('readingPlans.agenda.behind', `${p.displayName} is ${n} ${n === 1 ? 'day' : 'days'} behind schedule.`, { name: p.displayName, n })}
          </span>
        </Notice>
      );
    });

  // ---- Readings of one plan day -----------------------------------------------------------------------------
  const entryRows = (entry: ReadingPlans.AgendaEntry, compact = false) => {
    const p = byId.get(entry.enrollmentId);
    if (!p) return null;
    const readings = p.detail.plan.days[entry.day - 1]?.readings ?? [];
    return readings.map((reading, index) => {
      const text = readingText(p, reading);
      const done = p.progress.get(entry.day)?.has(index) ?? false;
      return (
        <li key={`${entry.enrollmentId}:${entry.day}:${index}`} className={`flex items-start gap-sm${compact ? ' text-sm' : ''}`}
          data-testid="agenda-reading">
          <Checkbox checked={done} tone="success" ariaLabel={t('readingPlans.today.markReading', { reading: text })}
            onChange={(checked) => onToggleReading(entry.enrollmentId, entry.day, index, checked)} />
          <span className="min-w-0">
            {several ? <span className="kth-text-muted">{`${p.displayName} · `}</span> : null}
            <button type="button" className="kth-link text-start" style={done ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}
              aria-label={labels.todayCard.openReading(text)}
              onClick={() => onOpenReading(entry.enrollmentId, { day: entry.day, index, reading })}>{text}</button>
          </span>
        </li>
      );
    });
  };

  const missedTag = (d: ReadingPlans.AgendaDate) => (d.state === 'missed'
    ? <span className="text-sm font-medium" style={{ color: 'var(--kth-warning)' }}>{tx('readingPlans.agenda.missedTag', 'Behind')}</span>
    : null);

  const dayHeading = (d: ReadingPlans.AgendaDate) => (
    <span className="flex flex-wrap items-baseline gap-sm">
      <span className="font-semibold">{labels.formatDayHeading(d.date)}</span>
      {d.today ? <span className="kth-badge">{tx('readingPlans.home.tag.today', 'Today')}</span> : null}
      {missedTag(d)}
    </span>
  );

  // ---- List -------------------------------------------------------------------------------------------------
  const listView = () => {
    const days = ReadingPlans.agenda(inputs, start, addDays(todayDate, LIST_AHEAD_DAYS), todayDate, rolloverHour)
      .filter((d) => d.entries.length > 0);
    if (days.length === 0) return <p className="m-0 text-sm kth-text-muted">{tx('readingPlans.agenda.nothing', 'Nothing to read in the next week.')}</p>;
    return (
      <ol className="m-0 p-0 list-none flex flex-col gap-md" data-testid="agenda-list">
        {days.map((d) => (
          <li key={d.date} className="flex flex-col gap-xs" data-date={d.date}>
            {dayHeading(d)}
            <ul className="m-0 p-0 list-none flex flex-col gap-xs">{d.entries.flatMap((e) => entryRows(e))}</ul>
          </li>
        ))}
      </ol>
    );
  };

  const describeCell = (c: ReadingPlans.CalendarDay) => {
    const parts = [labels.formatDayHeading(c.date), labels.monthCalendar.states[c.state]];
    if (c.today) parts.push(labels.monthCalendar.today);
    return parts.join(', ');
  };
  const pageDir = typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';

  // ---- The readings of the selected date (Week and Month) ---------------------------------------------------
  const dayPanel = (c: ReadingPlans.AgendaDate | null) => (
    <section className="flex flex-col gap-sm" data-testid="calendar-day" aria-label={c ? labels.formatDayHeading(c.date) : undefined}>
      {c ? (
        <>
          {dayHeading(c)}
          {c.entries.length === 0 ? (
            <p className="m-0 text-sm kth-text-muted">
              {c.state === 'rest' ? tx('readingPlans.agenda.rest', 'Rest day') : tx('readingPlans.calendar.nothing', 'No reading on this date.')}
            </p>
          ) : c.entries.map((e) => {
            const p = byId.get(e.enrollmentId);
            if (!p) return null;
            const done = ReadingPlans.isDayDone(p.detail.plan, p.progress, e.day);
            return (
              <div key={`${e.enrollmentId}:${e.day}`} className="flex flex-col gap-xs">
                <div className="flex flex-wrap items-baseline gap-sm">
                  <span className="text-sm font-medium me-auto">
                    {several ? `${p.displayName} · ` : ''}{t('readingPlans.home.day', { day: e.day })}
                  </span>
                  <button type="button" className="kth-link text-sm" onClick={() => onToggleDay(e.enrollmentId, e.day, !done)}>
                    {done ? labels.todayCard.markDayUnread : tx('readingPlans.home.markDayN', `Mark Day ${e.day} read`, { day: e.day })}
                  </button>
                </div>
                <ul className="m-0 p-0 list-none flex flex-col gap-xs">{entryRows({ ...e, enrollmentId: e.enrollmentId })}</ul>
              </div>
            );
          })}
        </>
      ) : null}
    </section>
  );

  // ---- Week: seven date blocks (the Month calendar's cells, one row and larger); the selected date's readings below.
  const weekView = () => {
    const range = ReadingPlans.weekRange(weekAnchor, weekStart);
    const cells: ReadingPlans.CalendarDay[] = ReadingPlans.agenda(inputs, range.from, range.to, todayDate, rolloverHour)
      .map((d) => ({ ...d, inMonth: true }));
    const selected = cells.find((c) => c.date === selectedDate) ?? null;
    const goWeek = (by: number) => { const from = addDays(range.from, 7 * by); setWeekAnchor(from); setSelectedDate(from); };
    return (
      <div className="flex flex-col gap-md" data-testid="agenda-week">
        <ReadingPlanMonthCalendar
          size="week"
          cells={cells}
          monthLabel={`${labels.formatDate(range.from)} – ${labels.formatDate(range.to)}`}
          weekdayNames={labels.weekdayNames}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onPreviousMonth={() => goWeek(-1)}
          onNextMonth={() => goWeek(1)}
          onThisMonth={() => { setWeekAnchor(todayDate); setSelectedDate(todayDate); }}
          formatDayNumber={labels.formatDayNumber}
          describe={describeCell}
          labels={{
            ...labels.monthCalendar,
            grid: tx('readingPlans.calendar.weekGrid', 'Reading week'),
            previousMonth: tx('readingPlans.agenda.prevWeek', 'Previous week'),
            nextMonth: tx('readingPlans.agenda.nextWeek', 'Next week'),
          }}
          dir={pageDir}
        />
        {dayPanel(selected)}
      </div>
    );
  };

  // ---- Month ------------------------------------------------------------------------------------------------
  const monthView = () => {
    const cells = ReadingPlans.monthCalendar(inputs, month, todayDate, rolloverHour, weekStart);
    const cell = cells.find((c) => c.date === selectedDate) ?? null;
    return (
      <div className="flex flex-wrap items-start gap-md" data-testid="agenda-month">
        <div style={{ flex: '1 1 17rem', maxInlineSize: '22rem' }}>
          <ReadingPlanMonthCalendar
            size="compact"
            cells={cells}
            monthLabel={labels.formatMonth(month)}
            weekdayNames={labels.weekdayNames}
            selectedDate={selectedDate}
            onSelectDate={(date) => { setSelectedDate(date); if (monthOf(date) !== month) setMonth(monthOf(date)); }}
            onPreviousMonth={() => { const m = addMonths(month, -1); setMonth(m); setSelectedDate(`${m}-01`); }}
            onNextMonth={() => { const m = addMonths(month, 1); setMonth(m); setSelectedDate(`${m}-01`); }}
            onThisMonth={() => { setMonth(monthOf(todayDate)); setSelectedDate(todayDate); }}
            formatDayNumber={labels.formatDayNumber}
            describe={describeCell}
            labels={labels.monthCalendar}
            dir={pageDir}
          />
        </div>
        <div style={{ flex: '1 1 15rem', minInlineSize: 0 }}>{dayPanel(cell)}</div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-md" data-testid="agenda-tab">
      {progressTiles()}
      {behindNotices()}
      {inputs.length > 0 ? (
        <>
          <SegmentedControl
            label={tx('readingPlans.home.view.label', 'Show')}
            value={view}
            onChange={(id) => setView(id as AgendaView)}
            options={[
              { id: 'list', label: tx('readingPlans.agenda.view.list', 'List') },
              { id: 'week', label: tx('readingPlans.home.view.week', 'Week') },
              { id: 'month', label: tx('readingPlans.home.view.month', 'Month') },
            ]}
          />
          {view === 'list' ? listView() : view === 'week' ? weekView() : monthView()}
        </>
      ) : null}
    </div>
  );
};

export default AgendaTab;
