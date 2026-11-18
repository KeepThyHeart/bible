import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import PlanHome from './PlanHome';
import { useReadingPlanLabels } from './useReadingPlanLabels';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

afterEach(() => uninstallTestService());

async function setup(startDate: string, pacing: 'fixed' | 'flexible', tick?: [number, number][]) {
  const { service } = installTestService();
  const e = await service.startPlan('stock:gospels-30', { startDate, pacing });
  for (const [day, i] of tick ?? []) await service.setReadingDone(e.id, day, i, true);
  const detail = await service.detail(e.id);
  const progress = ReadingPlans.indexCompletions(await service.completions(e.id), e.id);
  const cb = {
    onToggleReading: vi.fn(), onToggleDay: vi.fn(), onOpenReading: vi.fn(), onOpenSettings: vi.fn(), onViewPlan: vi.fn(),
    onShift: vi.fn(), onSwitchToFlexible: vi.fn(), onResume: vi.fn(),
  };
  const Harness = () => {
    const labels = useReadingPlanLabels();
    return <PlanHome detail={detail} progress={progress} labels={labels} displayName="Gospels" {...cb} />;
  };
  render(<Harness />);
  return { cb, detail };
}

describe('PlanHome', () => {
  it('shows the current day as the hero with a primary Start action, then Continue once something is ticked', async () => {
    const { cb } = await setup('2026-10-01', 'flexible');
    expect(screen.getByRole('list', { name: 'Where you are in the plan' })).toBeInTheDocument();
    expect(screen.queryByTestId('plan-day-previous')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-day-next')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /^Start reading: / }));
    expect(cb.onOpenReading).toHaveBeenCalledWith(expect.objectContaining({ day: 1, index: 0 }));
  });

  it('says Continue and shows three cards after day 1 is read; the date shows for fixed plans', async () => {
    await setup('2026-10-01', 'fixed', [[1, 0]]);
    expect(screen.getByRole('button', { name: /^Continue reading: / })).toBeInTheDocument();
    const current = screen.getByTestId('plan-day-current');
    expect(within(current).getByText('Day 2')).toBeInTheDocument();
    expect(within(current).getByText('Current reading')).toBeInTheDocument();
    expect(within(current).getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByTestId('plan-day-previous')).toBeInTheDocument();
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

  it('shows the behind notice with Reschedule and a confirm box for Switch to flexible', async () => {
    const { cb } = await setup('2026-09-28', 'fixed');
    const user = userEvent.setup();
    expect(screen.getByText(/^You are \d+ days? behind schedule$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reschedule from today' }));
    expect(cb.onShift).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Switch to flexible' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Switch to flexible' }));
    expect(cb.onSwitchToFlexible).toHaveBeenCalled();
  });
});
