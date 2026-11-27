import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getBookName, ReadingPlans } from '@bible/core/browser';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import AgendaTab from './AgendaTab';
import type { AgendaTabProps } from './AgendaTab';
import { useReadingPlanLabels } from './useReadingPlanLabels';
import { useReadingPlanData } from './readingPlanData';
import { getReadingPlanService } from '../readingPlansAPI';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

const { vid } = ReadingPlans;
const GOSPELS = 'The Gospels in 30 days';

const onOpenReading = vi.fn();
const onViewPlan = vi.fn();
const onReschedule = vi.fn();

/** The Agenda tab over the real service: data from `useReadingPlanData`, ticks written through the service. */
function Harness(props: { weekStart?: 0 | 1 }) {
  const labels = useReadingPlanLabels();
  const { data, loaded } = useReadingPlanData();
  const service = getReadingPlanService();
  if (!loaded) return null;
  const plans: AgendaTabProps['plans'] = data.enrollments.filter((e) => data.details.has(e.id)).map((e) => ({
    detail: data.details.get(e.id)!,
    completions: data.completions.get(e.id) ?? [],
    progress: data.progress.get(e.id) ?? new Map(),
    displayName: labels.localizePlanName(e.planKey, e.planName),
  }));
  return (
    <AgendaTab
      plans={plans}
      labels={labels}
      todayDate={service.today()}
      rolloverHour={service.rolloverHour()}
      weekStart={props.weekStart ?? 1}
      onToggleReading={(id, day, index, done) => { void service.setReadingDone(id, day, index, done); }}
      onToggleDay={(id, day, done) => { void service.setDayDone(id, day, done); }}
      onOpenReading={onOpenReading}
      onViewPlan={onViewPlan}
      onReschedule={onReschedule}
    />
  );
}

/** A user plan of `days` days with three John / Psalms / Proverbs readings each. */
async function threeReadingPlan(service: ReadingPlans.ReadingPlanService, name = 'Three', days = 30) {
  return service.savePlan({
    name,
    days: Array.from({ length: days }, (_, i) => ({
      readings: [
        { start: vid(43, (i % 21) + 1, 1), end: vid(43, (i % 21) + 1, 5) },
        { start: vid(19, i + 1, 1), end: vid(19, i + 1, 3) },
        { start: vid(20, (i % 31) + 1, 1), end: vid(20, (i % 31) + 1, 4) },
      ],
    })),
  });
}

const text = (r: ReadingPlans.Reading) => ReadingPlans.formatReading(r, getBookName);
const tiles = () => screen.queryAllByTestId('agenda-plan-tile');
const tile = (name: string) => {
  const t = tiles().find((x) => within(x).queryByRole('button', { name }));
  if (!t) throw new Error(`no tile for ${name}`);
  return t;
};
const listDates = () => Array.from(screen.getByTestId('agenda-list').querySelectorAll(':scope > li')).map((li) => li.getAttribute('data-date'));
const listDate = (date: string) => screen.getByTestId('agenda-list').querySelector(`:scope > li[data-date="${date}"]`) as HTMLElement;
/** The seven date blocks of the Week view (the shared calendar's cell buttons). */
const weekDays = () => Array.from(screen.getByTestId('agenda-week').querySelectorAll('button[data-date]')) as HTMLElement[];
const weekdayHeads = () => within(screen.getByTestId('agenda-week')).getAllByRole('columnheader').map((h) => h.textContent);
const monthCell = (date: string) => screen.getByTestId('month-calendar').querySelector(`button[data-date="${date}"]`) as HTMLElement;

async function chooseView(user: ReturnType<typeof userEvent.setup>, name: 'List' | 'Week' | 'Month') {
  await user.click(await screen.findByRole('radio', { name }));
}

describe('AgendaTab', () => {
  beforeEach(() => {
    usePreferencesStore.setState({ readingPlanAgendaView: 'list' });
    onOpenReading.mockClear(); onViewPlan.mockClear(); onReschedule.mockClear();
  });
  afterEach(() => { uninstallTestService(); window.localStorage.clear(); });

  describe('progress tiles', () => {
    it('one tile per active plan: a progress ring, the plan name (opens it) and how it stands', async () => {
      const { service } = installTestService();
      const a = await service.startPlan('stock:gospels-30');
      const mine = await threeReadingPlan(service);
      await service.startPlan(mine.key, { pacing: 'fixed', startDate: '2026-09-28' });
      const user = userEvent.setup();
      render(<Harness />);
      const progress = await screen.findByTestId('agenda-progress');
      expect(within(progress).getAllByTestId('agenda-plan-tile')).toHaveLength(2);
      expect(within(tile(GOSPELS)).getByRole('progressbar', { name: `${GOSPELS}: Plan progress` })).toBeInTheDocument();
      expect(tile(GOSPELS)).toHaveTextContent('On track');
      expect(tile('Three')).toHaveTextContent('3 days behind');
      expect(tile('Three')).toHaveTextContent('⚠');
      expect(tile(GOSPELS)).not.toHaveTextContent('⚠');
      await user.click(within(tile(GOSPELS)).getByRole('button', { name: GOSPELS }));
      expect(onViewPlan).toHaveBeenCalledWith(a.id);
    });

    it('a plan that has not started says when it starts; one read ahead says how far', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30', { pacing: 'fixed', startDate: '2026-10-05' });
      const mine = await threeReadingPlan(service, 'Ahead');
      const b = await service.startPlan(mine.key, { pacing: 'fixed' });
      await service.setDayDone(b.id, 1, true);
      await service.setDayDone(b.id, 2, true);
      render(<Harness />);
      await screen.findByTestId('agenda-progress');
      expect(tile(GOSPELS)).toHaveTextContent('This plan starts on Oct 5, 2026.');
      await waitFor(() => expect(tile('Ahead')).toHaveTextContent('1 day ahead'));
    });

    it('a paused plan has no tile', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30');
      const b = await service.startPlan('stock:nt-90');
      await service.pause(b.id);
      render(<Harness />);
      await screen.findByTestId('agenda-progress');
      expect(tiles()).toHaveLength(1);
      expect(tile(GOSPELS)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'New Testament in 90 days' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    });

    it('with only paused plans there are no tiles at all', async () => {
      const { service } = installTestService();
      const a = await service.startPlan('stock:gospels-30');
      await service.pause(a.id);
      render(<Harness />);
      await screen.findByTestId('agenda-tab');
      expect(screen.queryByTestId('agenda-progress')).not.toBeInTheDocument();
    });
  });

  describe('behind notice', () => {
    it('a fixed plan that is behind has a warning line whose Reschedule hands over the plan', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30');
      const b = await service.startPlan('stock:gospels-30', { pacing: 'fixed', startDate: '2026-09-29' });
      const user = userEvent.setup();
      render(<Harness />);
      const lines = await screen.findAllByTestId('behind-line');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toHaveTextContent(`${GOSPELS} is 2 days behind schedule.`);
      await user.click(screen.getByRole('button', { name: 'Reschedule' }));
      expect(onReschedule).toHaveBeenCalledWith(b.id);
    });

    it('no warning for a paused plan, a flexible plan or one that is level', async () => {
      const { service } = installTestService();
      const a = await service.startPlan('stock:gospels-30', { pacing: 'fixed', startDate: '2026-09-25' });
      await service.pause(a.id);
      await service.startPlan('stock:gospels-30', { startDate: '2026-09-25' });
      const c = await service.startPlan('stock:gospels-30', { pacing: 'fixed', startDate: '2026-09-30' });
      await service.setDayDone(c.id, 1, true);
      render(<Harness />);
      await screen.findByTestId('agenda-tab');
      expect(screen.queryByTestId('behind-line')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument();
    });
  });

  describe('List view', () => {
    it('is the default; runs from today to a week ahead when nothing earlier is unread', async () => {
      const { service } = installTestService();
      const e = await service.startPlan('stock:gospels-30');
      const plan = (await service.detail(e.id)).plan;
      const user = userEvent.setup();
      render(<Harness />);
      await screen.findByTestId('agenda-list');
      expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
      expect(listDates()).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
      const today = listDate('2026-10-01');
      expect(today).toHaveTextContent('Today');
      expect(today).toHaveTextContent('Thursday, Oct 1');
      // One plan: no plan-name prefix.
      expect(today).not.toHaveTextContent(`${GOSPELS} ·`);
      await user.click(within(today).getByRole('button', { name: `Open ${text(plan.days[0].readings[0])}` }));
      expect(onOpenReading).toHaveBeenCalledWith(e.id, { day: 1, index: 0, reading: plan.days[0].readings[0] });
    });

    it('starts at the earliest unread date', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30', { pacing: 'fixed', startDate: '2026-09-28' });
      render(<Harness />);
      await screen.findByTestId('agenda-list');
      expect(listDates()[0]).toBe('2026-09-28');
      expect(listDates().at(-1)).toBe('2026-10-07');
      expect(listDate('2026-09-28')).toHaveTextContent('Behind');
      expect(listDate('2026-10-01')).not.toHaveTextContent('Behind');
    });

    it('never starts more than 7 days back', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30', { pacing: 'fixed', startDate: '2026-09-10' });
      render(<Harness />);
      await screen.findByTestId('agenda-list');
      expect(listDates()[0]).toBe('2026-09-24');
    });

    it('skips read days at the start: the list opens at the first one still unread', async () => {
      const { service } = installTestService();
      const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed', startDate: '2026-09-28' });
      await service.setDayDone(e.id, 1, true);
      await service.setDayDone(e.id, 2, true);
      render(<Harness />);
      await screen.findByTestId('agenda-list');
      expect(listDates()[0]).toBe('2026-09-30');
    });

    it('ticks and unticks a reading through the checkbox', async () => {
      const { service } = installTestService();
      const mine = await threeReadingPlan(service);
      const e = await service.startPlan(mine.key);
      const user = userEvent.setup();
      render(<Harness />);
      await screen.findByTestId('agenda-list');
      const name = `Mark ${text(mine.days[0].readings[1])} as read`;
      await user.click(within(listDate('2026-10-01')).getByRole('checkbox', { name }));
      await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([1]));
      await waitFor(() => expect(within(listDate('2026-10-01')).getByRole('checkbox', { name })).toBeChecked());
      await user.click(within(listDate('2026-10-01')).getByRole('checkbox', { name }));
      await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([]));
    });

    it('with several plans each reading names its plan', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30');
      const mine = await threeReadingPlan(service);
      await service.startPlan(mine.key);
      render(<Harness />);
      await screen.findByTestId('agenda-list');
      const today = listDate('2026-10-01');
      expect(within(today).getAllByTestId('agenda-reading')).toHaveLength(4);
      expect(today).toHaveTextContent(`${GOSPELS} ·`);
      expect(today).toHaveTextContent('Three ·');
    });
  });

  describe('Week view', () => {
    it('has 7 date blocks under the weekday names; the arrows move by a week and Today comes back', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
      const user = userEvent.setup();
      render(<Harness />);
      await chooseView(user, 'Week');
      const week = await screen.findByTestId('agenda-week');
      // 2026-10-01 is a Thursday; weeks start on Monday.
      expect(weekDays().map((d) => d.getAttribute('data-date'))).toEqual(
        ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
      expect(within(week).getByTestId('month-label')).toHaveTextContent('Sep 28, 2026 – Oct 4, 2026');
      expect(weekdayHeads()[0]).toBe('Mon');
      expect(weekDays()[0]).toHaveTextContent('28');
      expect(weekDays()[0]).toHaveAttribute('data-state', 'none');
      expect(weekDays()[3]).toHaveAttribute('data-state', 'due');
      expect(weekDays()[4]).toHaveAttribute('data-state', 'upcoming');

      await user.click(screen.getByRole('button', { name: 'Next week' }));
      expect(weekDays()[0]).toHaveAttribute('data-date', '2026-10-05');
      expect(weekDays()).toHaveLength(7);
      await user.click(screen.getByRole('button', { name: 'Previous week' }));
      await user.click(screen.getByRole('button', { name: 'Previous week' }));
      expect(weekDays()[0]).toHaveAttribute('data-date', '2026-09-21');
      await user.click(within(screen.getByTestId('agenda-week')).getByRole('button', { name: 'Today' }));
      expect(weekDays()[0]).toHaveAttribute('data-date', '2026-09-28');
    });

    it('follows the week start (Sunday) it is given', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
      const user = userEvent.setup();
      render(<Harness weekStart={0} />);
      await chooseView(user, 'Week');
      await screen.findByTestId('agenda-week');
      expect(weekDays()[0]).toHaveAttribute('data-date', '2026-09-27');
      expect(weekdayHeads()[0]).toBe('Sun');
    });

    it('opens on the earliest unread date; selecting a block shows its readings below, which tick', async () => {
      const { service } = installTestService();
      const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
      const plan = (await service.detail(e.id)).plan;
      const user = userEvent.setup();
      render(<Harness />);
      await chooseView(user, 'Week');
      await screen.findByTestId('agenda-week');
      // The selected block starts on today's (first unread) date, with its readings below.
      expect(weekDays()[3]).toHaveAttribute('aria-pressed', 'true');
      expect(within(screen.getByTestId('calendar-day')).getByRole('checkbox', { name: `Mark ${text(plan.days[0].readings[0])} as read` })).toBeInTheDocument();
      await user.click(weekDays()[4]);
      expect(weekDays()[4]).toHaveAttribute('aria-pressed', 'true');
      await user.click(within(screen.getByTestId('calendar-day')).getByRole('checkbox', { name: `Mark ${text(plan.days[1].readings[0])} as read` }));
      await waitFor(async () => expect(await service.dayProgress(e.id, 2)).toEqual([0]));
      await waitFor(() => expect(weekDays()[4]).toHaveAttribute('data-state', 'done'));
    });
  });

  describe('Month view', () => {
    it('shows the compact calendar; clicking a date shows its readings beside it', async () => {
      const { service } = installTestService();
      const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
      const plan = (await service.detail(e.id)).plan;
      const user = userEvent.setup();
      render(<Harness />);
      await chooseView(user, 'Month');
      const cal = await screen.findByTestId('month-calendar');
      expect(cal).toHaveAttribute('data-size', 'compact');
      expect(screen.getByTestId('month-label')).toHaveTextContent('October 2026');
      // Today is selected at first.
      expect(monthCell('2026-10-01')).toHaveAttribute('aria-pressed', 'true');
      expect(monthCell('2026-10-01')).toHaveAttribute('data-state', 'due');
      expect(screen.getByTestId('calendar-day')).toHaveTextContent('Thursday, Oct 1');

      await user.click(monthCell('2026-10-03'));
      const side = screen.getByTestId('calendar-day');
      expect(side).toHaveAccessibleName('Saturday, Oct 3');
      expect(side).toHaveTextContent('Day 3');
      expect(within(side).getByRole('button', { name: `Open ${text(plan.days[2].readings[0])}` })).toBeInTheDocument();
      // A date before the plan has nothing.
      await user.click(monthCell('2026-09-30'));
      expect(screen.getByTestId('calendar-day')).toHaveTextContent('No reading on this date.');
    });

    it('marks a whole day read (and unread) from the side panel', async () => {
      const { service } = installTestService();
      const mine = await threeReadingPlan(service);
      const e = await service.startPlan(mine.key, { pacing: 'fixed' });
      const user = userEvent.setup();
      render(<Harness />);
      await chooseView(user, 'Month');
      await screen.findByTestId('month-calendar');
      await user.click(monthCell('2026-10-02'));
      await user.click(within(screen.getByTestId('calendar-day')).getByRole('button', { name: 'Mark Day 2 read' }));
      await waitFor(async () => expect(await service.dayProgress(e.id, 2)).toEqual([0, 1, 2]));
      await waitFor(() => expect(monthCell('2026-10-02')).toHaveAttribute('data-state', 'done'));
      await user.click(within(screen.getByTestId('calendar-day')).getByRole('button', { name: 'Mark day unread' }));
      await waitFor(async () => expect(await service.dayProgress(e.id, 2)).toEqual([]));
    });

    it('moves by month, and Today comes back', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
      const user = userEvent.setup();
      render(<Harness />);
      await chooseView(user, 'Month');
      await screen.findByTestId('month-calendar');
      await user.click(screen.getByRole('button', { name: 'Next month' }));
      expect(screen.getByTestId('month-label')).toHaveTextContent('November 2026');
      expect(monthCell('2026-11-01')).toHaveAttribute('aria-pressed', 'true');
      await user.click(within(screen.getByTestId('month-calendar')).getByRole('button', { name: 'Today' }));
      expect(screen.getByTestId('month-label')).toHaveTextContent('October 2026');
      expect(monthCell('2026-10-01')).toHaveAttribute('aria-pressed', 'true');
      // A date of the next month shown in the grid switches to that month.
      await user.click(monthCell('2026-11-01'));
      expect(screen.getByTestId('month-label')).toHaveTextContent('November 2026');
    });

    for (const pacing of ['fixed', 'flexible'] as const) {
      it(`a reading ticked ahead shows as done on its own date (${pacing})`, async () => {
        const { service } = installTestService();
        const e = await service.startPlan('stock:gospels-30', { pacing });
        await service.setReadingDone(e.id, 5, 0, true);
        const user = userEvent.setup();
        render(<Harness />);
        await chooseView(user, 'Month');
        await screen.findByTestId('month-calendar');
        expect(monthCell('2026-10-05')).toHaveAttribute('data-state', 'done');
        // It does not land on the date it was ticked on, and today is still today's reading.
        expect(monthCell('2026-10-01')).toHaveAttribute('data-state', 'due');
        expect(monthCell('2026-10-04')).toHaveAttribute('data-state', 'upcoming');
        expect(monthCell('2026-10-06')).toHaveAttribute('data-state', 'upcoming');
        await user.click(monthCell('2026-10-05'));
        const side = screen.getByTestId('calendar-day');
        expect(side).toHaveTextContent('Day 5');
        expect(within(side).getByRole('checkbox')).toBeChecked();
        expect(within(side).getByRole('button', { name: 'Mark day unread' })).toBeInTheDocument();
        await user.click(monthCell('2026-10-01'));
        expect(screen.getByTestId('calendar-day')).toHaveTextContent('Day 1');
        expect(screen.getByTestId('calendar-day')).not.toHaveTextContent('Day 5');

        // The list and week agree.
        await chooseView(user, 'Week');
        await screen.findByTestId('agenda-week');
        await user.click(screen.getByRole('button', { name: 'Next week' }));
        expect(weekDays()[0]).toHaveAttribute('data-date', '2026-10-05');
        expect(weekDays()[0]).toHaveAttribute('data-state', 'done');
        await chooseView(user, 'List');
        expect(within(listDate('2026-10-05')).getByRole('checkbox')).toBeChecked();
        expect(within(listDate('2026-10-01')).getByRole('checkbox')).not.toBeChecked();
      });
    }

    it('Week and Month agree on every date\'s state', async () => {
      const { service } = installTestService();
      const mine = await threeReadingPlan(service);
      const a = await service.startPlan(mine.key, { pacing: 'fixed', startDate: '2026-09-27', readingDays: [1, 2, 3, 4, 5, 6] });
      await service.setDayDone(a.id, 1, true); // Mon Sep 28
      await service.setReadingDone(a.id, 2, 0, true); // Tue Sep 29: partly
      await service.setReadingDone(a.id, 6, 1, true); // Sat Oct 3: partly, ahead
      const b = await service.startPlan('stock:gospels-30');
      await service.setReadingDone(b.id, 1, 0, true);
      const user = userEvent.setup();
      render(<Harness />);
      await chooseView(user, 'Week');
      await screen.findByTestId('agenda-week');
      const weekStates = new Map(weekDays().map((d) => [d.getAttribute('data-date')!, d.getAttribute('data-state')]));
      expect(weekStates.size).toBe(7);
      // The week of the first unread date (Tue Sep 29).
      expect([...weekStates.keys()][0]).toBe('2026-09-28');
      expect(weekStates.get('2026-09-28')).toBe('done');
      expect(weekStates.get('2026-09-29')).toBe('missed');
      expect(weekStates.get('2026-10-01')).toBe('due');
      expect(weekStates.get('2026-10-03')).toBe('partial');
      expect(weekStates.get('2026-10-04')).toBe('upcoming');

      await chooseView(user, 'Month');
      await screen.findByTestId('month-calendar');
      // The month opens on the first unread date's month; its whole weeks reach into October.
      expect(screen.getByTestId('month-label')).toHaveTextContent('September 2026');
      for (const [date, state] of weekStates) expect([date, monthCell(date)?.getAttribute('data-state')]).toEqual([date, state]);
    });
  });

  describe('view choice', () => {
    it('switching views is kept in the app preferences (saved with the session) and opens there next time', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30');
      const user = userEvent.setup();
      const first = render(<Harness />);
      await chooseView(user, 'Week');
      expect(usePreferencesStore.getState().readingPlanAgendaView).toBe('week');
      expect(usePreferencesStore.getState().getSessionData().readingPlanAgendaView).toBe('week');
      await chooseView(user, 'Month');
      first.unmount();
      render(<Harness />);
      expect(await screen.findByTestId('agenda-month')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    });

    it('a saved session restores the view, and anything unknown falls back to List', async () => {
      const { service } = installTestService();
      await service.startPlan('stock:gospels-30');
      usePreferencesStore.getState().loadFromSession({ readingPlanAgendaView: 'week' } as never);
      const first = render(<Harness />);
      expect(await screen.findByTestId('agenda-week')).toBeInTheDocument();
      first.unmount();
      usePreferencesStore.getState().loadFromSession({ readingPlanAgendaView: 'bogus' } as never);
      render(<Harness />);
      expect(await screen.findByTestId('agenda-list')).toBeInTheDocument();
    });
  });
});
