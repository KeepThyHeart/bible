import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import PlanHome from './PlanHome';
import type { PlanHomeProps } from './PlanHome';
import { useReadingPlanLabels } from './useReadingPlanLabels';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

afterEach(() => uninstallTestService());

interface Opts { tick?: [number, number][]; now?: Date; readingDays?: ReadingPlans.Weekday[]; props?: Partial<PlanHomeProps>; catchUp?: boolean }

async function setup(startDate: string, pacing: 'fixed' | 'flexible', opts: Opts = {}) {
  const { service } = installTestService(opts.now);
  const e = await service.startPlan('stock:gospels-30', { startDate, pacing, ...(opts.readingDays ? { readingDays: opts.readingDays } : {}) });
  if (opts.catchUp) await service.startCatchUp(e.id);
  for (const [day, i] of opts.tick ?? []) await service.setReadingDone(e.id, day, i, true);
  const detail = await service.detail(e.id);
  const progress = ReadingPlans.indexCompletions(await service.completions(e.id), e.id);
  const preview = await service.reschedulePreview(e.id);
  const cb = {
    onToggleReading: vi.fn(), onToggleDay: vi.fn(), onOpenReading: vi.fn(), onOpenSettings: vi.fn(), onViewPlan: vi.fn(),
    onStartCatchUp: vi.fn(), onStopCatchUp: vi.fn(), loadPreview: vi.fn().mockResolvedValue(preview), onMoveDates: vi.fn(),
    onUndoMove: vi.fn(), onSwitchToFlexible: vi.fn(), onResume: vi.fn(),
  };
  const Harness = () => {
    const labels = useReadingPlanLabels();
    return <PlanHome detail={detail} progress={progress} labels={labels} displayName="Gospels" {...cb} {...opts.props} />;
  };
  render(<Harness />);
  return { cb, detail, preview, service, enrollment: e };
}

describe('PlanHome', () => {
  it('flexible: the hero is the current day with a primary Start action, the strip shows the week, nothing else', async () => {
    const { cb } = await setup('2026-10-01', 'flexible');
    const hero = screen.getByTestId('plan-day-current');
    expect(hero).toHaveAttribute('data-focus-kind', 'current');
    expect(within(hero).getByText('Day 1')).toBeInTheDocument();
    expect(within(hero).getByText('Current reading')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-day-previous')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-day-next')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'This week' }).querySelectorAll('li')).toHaveLength(7);
    expect(screen.queryByTestId('behind-panel')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /^Start reading: / }));
    expect(cb.onOpenReading).toHaveBeenCalledWith(expect.objectContaining({ day: 1, index: 0 }));
  });

  it('fixed and on schedule: the hero is tagged Today with its date; ticking keeps the day through the day', async () => {
    await setup('2026-10-01', 'fixed', { tick: [[1, 0]] });
    const hero = screen.getByTestId('plan-day-current');
    expect(hero).toHaveAttribute('data-focus-kind', 'today');
    expect(within(hero).getByTestId('hero-title')).toHaveTextContent(/^Today · .*2026 · Day 1$/);
    expect(screen.queryByTestId('plan-day-previous')).not.toBeInTheDocument();
  });

  it('fixed and behind: today\'s day is the hero, with one collapsed row for the earlier days', async () => {
    await setup('2026-09-28', 'fixed');
    const hero = screen.getByTestId('plan-day-current');
    expect(within(hero).getByTestId('hero-title')).toHaveTextContent(/^Today · .* · Day 4$/);
    expect(screen.getByText('3 earlier days unread')).toBeInTheDocument();
    expect(screen.getByTestId('behind-panel')).not.toHaveAttribute('open');
    expect(screen.getByTestId('plan-day-previous')).toHaveTextContent(/^Day 3 · .* · not read$/);
    expect(screen.queryByText(/behind schedule/)).not.toBeInTheDocument();
    // The hero's checkboxes are today's readings (Day 4), not Day 1's.
    for (const box of within(hero).getAllByRole('checkbox')) expect(box).toBeInTheDocument();
  });

  it('shows three named choices; each does its own thing', async () => {
    const { cb, preview } = await setup('2026-09-28', 'fixed');
    const user = userEvent.setup();
    await user.click(screen.getByText('3 earlier days unread'));
    const panel = screen.getByTestId('behind-panel');
    expect(within(panel).getByRole('button', { name: 'Catch up gradually' })).toBeInTheDocument();
    expect(within(panel).getByText(/^Read 1 extra day with each day's reading until you are level, about 3 days\.$/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Catch up gradually' }));
    expect(cb.onStartCatchUp).toHaveBeenCalled();

    await user.click(within(panel).getByRole('button', { name: 'Move the dates' }));
    const box = await screen.findByRole('alertdialog');
    const text = box.textContent ?? '';
    expect(cb.loadPreview).toHaveBeenCalled();
    expect(text).toContain('The plan used to start on');
    expect(text).toMatch(/Sep 28, 2026/);
    expect(text).toMatch(/The end date moves from .*2026 to .*2026/);
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(cb.onMoveDates).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole('button', { name: 'Move the dates' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Move the dates' }));
    expect(cb.onMoveDates).toHaveBeenCalledWith(preview);

    await user.click(within(panel).getByRole('button', { name: 'Stop tracking dates' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Switch to flexible' }));
    expect(cb.onSwitchToFlexible).toHaveBeenCalled();
  });

  it('while catching up it says so with a Stop, and the extra days sit inside the hero', async () => {
    const { cb } = await setup('2026-09-28', 'fixed', { catchUp: true });
    const user = userEvent.setup();
    const hero = screen.getByTestId('plan-day-current');
    expect(within(hero).getByTestId('catch-up-extras')).toHaveTextContent('Catching up: Day 1');
    await user.click(screen.getByText('3 earlier days unread'));
    expect(screen.getByTestId('catch-up-on')).toHaveTextContent('Catching up: 1 extra a day');
    expect(screen.queryByRole('button', { name: 'Catch up gradually' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(cb.onStopCatchUp).toHaveBeenCalled();
  });

  it('after the plan\'s end there is no gradual catch-up', async () => {
    await setup('2026-08-01', 'fixed');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('behind-panel').querySelector('summary')!);
    expect(screen.getByTestId('plan-day-current')).toHaveAttribute('data-focus-kind', 'nextUnread');
    expect(screen.queryByRole('button', { name: 'Catch up gradually' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move the dates' })).toBeInTheDocument();
  });

  it('a rest day shows the next day due as Next, with the date', async () => {
    // 2026-10-01 is a Thursday: read Mon-Wed only.
    await setup('2026-09-28', 'fixed', { readingDays: [1, 2, 3] });
    expect(screen.getByTestId('plan-day-current')).toHaveAttribute('data-focus-kind', 'upcoming');
    expect(screen.getByTestId('hero-title')).toHaveTextContent(/^Next · .* · Day \d+$/);
  });

  it('shows the Undo notice for a move that still applies, naming the old start date', async () => {
    const undo = { enrollmentId: 'x', oldStartDate: '2026-09-28', oldCatchUp: null, newStartDate: '2026-10-01', movedOn: '2026-10-01' };
    const { cb } = await setup('2026-10-01', 'fixed', { props: { scheduleUndo: undo } });
    expect(screen.getByTestId('moved-notice')).toHaveTextContent(/Dates moved\. The plan used to start on Sep 28, 2026\..*start date in Plan settings\./);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }));
    expect(cb.onUndoMove).toHaveBeenCalledWith(undo);
  });

  it('calls the toggle and settings callbacks', async () => {
    const { cb } = await setup('2026-10-01', 'flexible');
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId('plan-day-current')).getAllByRole('checkbox')[0]);
    expect(cb.onToggleReading).toHaveBeenCalledWith(1, 0, true);
    await user.click(screen.getByRole('button', { name: 'Mark day read' }));
    expect(cb.onToggleDay).toHaveBeenCalledWith(1, true);
    await user.click(screen.getByRole('button', { name: 'Plan settings' }));
    await user.click(screen.getByRole('button', { name: 'View full plan' }));
    expect(cb.onOpenSettings).toHaveBeenCalled();
    expect(cb.onViewPlan).toHaveBeenCalled();
  });
});
