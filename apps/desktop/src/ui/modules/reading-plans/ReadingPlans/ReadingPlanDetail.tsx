/**
 * The "full plan" view of one enrollment (tasks 0073, 0196, 0222): stats, the table of all days and passages
 * (check, uncheck and open each, optionally one highlighted) and the calendar export. Settings, pause and
 * remove live in the plan settings dialog, opened through `onOpenSettings`.
 */
import { saveTextFile } from '../../../utils/saveTextFile';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { Checkbox, MessageBox, ProgressBar } from '@bible/ui';
import PointerMenu from '../../../components/shared/PointerMenu';
import { rpTextWith } from '../rpText';
import { useI18n } from '../../../contexts/useI18n';
import { getReadingPlanService } from '../readingPlansAPI';
import { openPlanReading } from '../useActiveReadingStore';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';
import { shownPercent } from './readingPlanData';

interface Props {
  enrollmentId: string;
  labels: ReadingPlanLabelSet;
  /** Display name of the plan (localized for stock plans). */
  displayName: (planKey: string, fallback: string) => string;
  /** A reading to highlight and scroll to (from the reader's "View reading plan"). */
  highlight?: { day: number; index: number } | null;
  onBack: () => void;
  onOpenSettings: () => void;
  onError: (message: string | null) => void;
}

const ReadingPlanDetail: React.FC<Props> = ({ enrollmentId, labels, displayName, highlight = null, onBack, onOpenSettings, onError }) => {
  const { t } = useI18n();
  const showStreak = usePreferencesStore((s) => s.readingPlanShowStreak);
  const service = getReadingPlanService();
  const [detail, setDetail] = useState<ReadingPlans.EnrollmentDetail | null>(null);
  const [progress, setProgress] = useState<ReadingPlans.ProgressIndex>(new Map());
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const currentRowRef = useRef<HTMLTableRowElement | null>(null);
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);
  const tableBoxRef = useRef<HTMLDivElement | null>(null);
  const scrolled = useRef(false);
  const [alarm, setAlarm] = useState('');
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; day: number } | null>(null);
  const [confirmUnread, setConfirmUnread] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, completions] = await Promise.all([service.detail(enrollmentId), service.completions(enrollmentId)]);
      setProgress(ReadingPlans.indexCompletions(completions, enrollmentId));
      setDetail(d);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [service, enrollmentId, onError]);

  useEffect(() => {
    void load();
    return service.subscribe((e) => { if (e.type === 'changed') void load(); });
  }, [service, load]);

  // A highlighted reading is always visible, whatever the filter.
  const highlightKey = highlight ? `${highlight.day}:${highlight.index}` : '';
  useEffect(() => { if (highlightKey) setFilter('all'); }, [highlightKey]);
  const scrolledHighlight = useRef('');

  // Scroll the table's own box (not the whole pane) so the plan's stats stay in view above it: to the highlighted
  // reading whenever it changes, else once to the current row when the table first has data.
  useEffect(() => {
    if (!detail) return;
    const box = tableBoxRef.current;
    // Once per highlight (not on every reload, or ticking a far row would snap the table back), else once to the current row.
    const toHighlight = highlightKey !== '' && scrolledHighlight.current !== highlightKey;
    const row = toHighlight ? highlightRowRef.current : scrolled.current || highlightKey ? null : currentRowRef.current;
    if (toHighlight && !row) return; // the row is not rendered yet (filter switching to All)
    scrolled.current = true;
    if (toHighlight) scrolledHighlight.current = highlightKey;
    if (box && row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2);
  }, [detail, highlightKey, filter]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      onError(null);
      await fn();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError]);

  if (!detail) return <div className="p-md" aria-busy="true" />;
  const { enrollment: e, plan, stats, statuses } = detail;
  const name = displayName(e.planKey, e.planName);
  const readingText = (r: ReadingPlans.Reading) => {
    const prefix = r.track ? `${labels.trackName(r.track, plan.tracks?.find((x) => x.id === r.track)?.name)}: ` : '';
    return `${prefix}${labels.formatReading(r)}`;
  };

  const exportIcs = async () => {
    const completions = await service.completions(e.id);
    const ics = ReadingPlans.planToIcs(plan, e, completions, {
      formatReading: labels.formatReading,
      today: service.today(),
      title: name,
      ...(alarm ? { alarmTime: alarm } : {}),
    });
    const filename = `${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'reading-plan'}.ics`;
    await saveTextFile(filename, ics, 'text/calendar;charset=utf-8');
  };

  const statusText = t(`readingPlans.status.${e.status}`);

  // The same "today" as Home and the Today tab.
  const current = detail.today.completed ? null : ReadingPlans.focusDay(detail.today);
  const focusKind = detail.today.focusKind ?? 'current';
  const focusTag = focusKind === 'today' ? rpTextWith(t, 'readingPlans.home.tag.today', 'Today')
    : focusKind === 'nextUnread' ? rpTextWith(t, 'readingPlans.home.tag.nextUnread', 'Next unread')
      : focusKind === 'upcoming' ? rpTextWith(t, 'readingPlans.home.tag.upcoming', 'Next')
        : t('readingPlans.home.tag.current');
  const showSchedule = stats.finishBasis === 'schedule' || (stats.finishBasis === 'pace' && e.pacing === 'fixed'
    && stats.scheduledFinish && stats.scheduledFinish !== stats.estimatedFinish);

  return (
    <div className="flex flex-col gap-md" data-testid="reading-plan-detail">
      <div className="flex flex-wrap items-center gap-sm">
        <button type="button" className="kth-back" onClick={onBack}>
          <span className="kth-back__icon" aria-hidden="true">{'‹'}</span>
          {t('readingPlans.nav.back')}
        </button>
        <h2 className="text-lg font-semibold m-0">{name}</h2>
        <span className="kth-text-muted text-xs flex-1">{statusText}</span>
        <button type="button" className="kth-btn kth-btn--sm" onClick={onOpenSettings}>{t('readingPlans.home.planSettings')}</button>
      </div>

      <section className="flex flex-col gap-xs text-sm" aria-label={t('readingPlans.detail.stats')}>
        <div>{t('readingPlans.detail.daysRead', { done: stats.daysDone, total: stats.dayCount })}</div>
        <ProgressBar value={stats.percent} label={t('readingPlans.detail.percent', { percent: shownPercent(stats.percent) })}
          valueText={t('readingPlans.card.percent', { percent: shownPercent(stats.percent) })} />
        {stats.finishBasis === 'pace' && stats.estimatedFinish ? (
          <div>
            {t('readingPlans.detail.estimatedFinish', { date: labels.formatDate(stats.estimatedFinish) })}
            <div className="kth-text-muted text-xs">{t('readingPlans.detail.estimatedFinishHint')}</div>
          </div>
        ) : null}
        {showSchedule && stats.scheduledFinish ? (
          <div>
            {t('readingPlans.detail.scheduledFinish', { date: labels.formatDate(stats.scheduledFinish) })}
            {stats.finishBasis === 'schedule' && e.pacing === 'flexible' ? (
              <div className="kth-text-muted text-xs">{t('readingPlans.detail.scheduledFinishHint')}</div>
            ) : null}
          </div>
        ) : null}
        {showStreak ? <div>{t('readingPlans.detail.streak', { count: stats.streak })}</div> : null}
      </section>

      <section className="flex flex-col gap-sm" aria-label={t('readingPlans.table.title')}>
        <div className="flex items-center gap-sm">
          <h3 className="text-sm font-semibold m-0 flex-1">{t('readingPlans.table.title')}</h3>
          <div role="group" aria-label={t('readingPlans.table.filter')} className="flex gap-xs">
            {(['all', 'unread'] as const).map((f) => (
              <button key={f} type="button" className={`kth-btn kth-btn--sm${filter === f ? ' kth-btn--primary' : ''}`} aria-pressed={filter === f}
                onClick={() => setFilter(f)}>{t(`readingPlans.table.filter.${f}`)}</button>
            ))}
          </div>
        </div>
        <div ref={tableBoxRef} className="overflow-auto rounded border border-border relative" style={{ maxHeight: '28rem' }}>
          <table className="kth-table" data-testid="reading-plan-table">
            <thead className="sticky top-0" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
              <tr>
                <th scope="col" className="kth-table__head">{t('readingPlans.table.day')}</th>
                {e.pacing === 'fixed' ? <th scope="col" className="kth-table__head">{t('readingPlans.table.date')}</th> : null}
                <th scope="col" className="kth-table__head">{t('readingPlans.table.readings')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.days.map((d, i) => {
                const day = i + 1;
                const done = progress.get(day);
                const allDone = ReadingPlans.isDayDone(plan, progress, day);
                const hasHighlight = highlight?.day === day;
                if (filter === 'unread' && allDone && !hasHighlight) return null;
                const isCurrent = day === current;
                const status = statuses[i];
                return (
                  <tr key={day} ref={hasHighlight ? highlightRowRef : isCurrent ? currentRowRef : undefined} data-testid="plan-table-row" data-day={day}
                    data-today={isCurrent ? 'true' : undefined} aria-current={isCurrent ? (e.pacing === 'fixed' ? 'date' : 'step') : undefined}
                    style={isCurrent ? { backgroundColor: 'var(--theme-accent-bg, rgba(59,130,246,0.14))' } : status === 'missed' ? { backgroundColor: 'var(--theme-warning-bg, rgba(250,180,40,0.14))' } : undefined}>
                    <th scope="row" className="kth-table__cell text-start font-medium whitespace-nowrap align-top"
                      onContextMenu={(ev) => { ev.preventDefault(); setRowMenu({ x: ev.clientX, y: ev.clientY, day }); }}>
                      {day}{isCurrent ? <span className="text-xs ms-xs" style={{ color: 'var(--theme-accent-primary, #3b82f6)' }}>{focusTag}</span> : null}
                      <button type="button" className="kth-btn kth-btn--sm kth-btn--ghost ms-xs" aria-haspopup="menu"
                        aria-label={rpTextWith(t, 'readingPlans.table.rowActions', 'Actions for day {day}', { day })}
                        onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setRowMenu({ x: r.left, y: r.bottom, day }); }}>
                        {'\u22EF'}
                      </button>
                    </th>
                    {e.pacing === 'fixed' ? <td className="kth-table__cell whitespace-nowrap align-top">{labels.formatDate(ReadingPlans.dateForDay(e, day))}</td> : null}
                    <td className="kth-table__cell">
                      <ul className="m-0 p-0 list-none flex flex-col gap-xs">
                        {d.readings.map((r, j) => {
                          const checked = done?.has(j) ?? false;
                          const text = readingText(r);
                          const marked = highlight?.day === day && highlight.index === j;
                          return (
                            <li key={j} className="flex flex-wrap items-center gap-sm rounded" data-highlight={marked ? 'true' : undefined}
                              style={marked ? { outline: '2px solid var(--theme-accent-primary, #3b82f6)', outlineOffset: 2, padding: '0.125rem 0.375rem' } : undefined}>
                              <Checkbox tone="success" checked={checked} ariaLabel={t('readingPlans.table.markReading', { reading: text, day })}
                                onChange={(v) => void run(() => service.setReadingDone(e.id, day, j, v))} />
                              <button type="button" className="kth-link" style={checked ? { opacity: 0.7 } : undefined} aria-label={t('readingPlans.card.openReading', { reading: text })}
                                onClick={() => openPlanReading({ enrollmentId: e.id, day, index: j, reading: r })}>{text}</button>
                              {marked && checked ? <span className="kth-badge">{t('readingPlans.detail.justRead')}</span> : null}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-sm" aria-label={t('readingPlans.detail.actions')}>
        <label className="flex items-center gap-xs text-sm">
          {t('readingPlans.detail.alarmTime')}
          <input type="time" className="kth-input" value={alarm} onChange={(ev) => setAlarm(ev.target.value)} />
        </label>
        <button type="button" className="kth-btn kth-btn--sm" onClick={() => void run(exportIcs)}>{t('readingPlans.detail.exportIcs')}</button>
      </section>
      {rowMenu ? (
        <PointerMenu
          x={rowMenu.x}
          y={rowMenu.y}
          role="menu"
          className="border rounded shadow text-sm"
          style={{ backgroundColor: 'var(--theme-bg-primary)', borderColor: 'var(--theme-border-primary)' }}
          onMouseDown={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => { if (ev.key === 'Escape') setRowMenu(null); }}
        >
          <button type="button" role="menuitem" autoFocus className="block w-full text-start px-3 py-1.5 hover:bg-background-hover"
            onClick={() => { const day = rowMenu.day; setRowMenu(null); void run(() => service.setDaysDoneThrough(e.id, day, true)); }}>
            {rpTextWith(t, 'readingPlans.table.markThroughRead', 'Mark everything up to here as read')}
          </button>
          <button type="button" role="menuitem" className="block w-full text-start px-3 py-1.5 hover:bg-background-hover"
            onClick={() => { setConfirmUnread(rowMenu.day); setRowMenu(null); }}>
            {rpTextWith(t, 'readingPlans.table.markThroughUnread', 'Mark everything up to here as unread')}
          </button>
        </PointerMenu>
      ) : null}
      <MessageBox
        open={confirmUnread !== null}
        tone="danger"
        title={rpTextWith(t, 'readingPlans.table.markThroughUnreadTitle', 'Mark days as unread?')}
        message={rpTextWith(t, 'readingPlans.table.markThroughConfirm', 'Days 1 to {day} will be marked unread. The record of when you read them is lost.', { day: confirmUnread ?? 0 })}
        confirmLabel={rpTextWith(t, 'readingPlans.table.markThroughUnreadConfirm', 'Mark as unread')}
        cancelLabel={t('readingPlans.card.cancel')}
        onConfirm={() => { const day = confirmUnread; setConfirmUnread(null); if (day !== null) void run(() => service.setDaysDoneThrough(e.id, day, false)); }}
        onCancel={() => setConfirmUnread(null)}
      />
    </div>
  );
};

export default ReadingPlanDetail;
