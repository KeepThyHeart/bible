import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import PlanSettingsDialog from './PlanSettingsDialog';
import type { PlanSettingsMode } from './PlanSettingsDialog';
import { useReadingPlanLabels } from './useReadingPlanLabels';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

afterEach(() => uninstallTestService());

function Harness(props: { mode: PlanSettingsMode; onClose: () => void; onStarted?: () => void; onError?: (m: string | null) => void }) {
  const labels = useReadingPlanLabels();
  return (
    <PlanSettingsDialog mode={props.mode} open onClose={props.onClose} onStarted={props.onStarted ?? (() => {})} onRemoved={() => {}}
      labels={labels} displayName={labels.localizePlanName} onError={props.onError ?? (() => {})} />
  );
}

describe('PlanSettingsDialog', () => {
  it('start mode: date field, flexible by default, Start button with the plan name', async () => {
    const { service } = installTestService();
    const plan = (await service.library()).find((p) => p.key === 'stock:gospels-30')!;
    const onStarted = vi.fn();
    render(<Harness mode={{ kind: 'start', plan }} onClose={() => {}} onStarted={onStarted} />);
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-10-01');
    expect(screen.getByRole('radio', { name: /Flexible/ })).toBeChecked();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start Reading Plan: The Gospels in 30 days' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(await service.enrollments()).toHaveLength(1);
  });

  it('start mode: an invalid date disables Start', async () => {
    const { service } = installTestService();
    const plan = (await service.library())[0];
    render(<Harness mode={{ kind: 'start', plan }} onClose={() => {}} />);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Start date'));
    expect(screen.getByRole('button', { name: /^Start Reading Plan/ })).toBeDisabled();
  });

  it('edit mode: flexible -> fixed on Save moves the schedule to today; the start date is hidden while flexible', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30', { startDate: '2026-09-20' });
    const detail = await service.detail(e.id);
    const onClose = vi.fn();
    render(<Harness mode={{ kind: 'edit', detail }} onClose={onClose} />);
    const user = userEvent.setup();
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Fixed/ }));
    expect(screen.getByLabelText('Start date')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const after = (await service.enrollments())[0];
    expect(after.pacing).toBe('fixed');
    expect(after.startDate).toBe('2026-10-01');
  });

  it('edit mode: fixed -> flexible asks first and Cancel keeps the plan fixed', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
    const detail = await service.detail(e.id);
    render(<Harness mode={{ kind: 'edit', detail }} onClose={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Flexible/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const box = await screen.findByRole('alertdialog');
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect((await service.enrollments())[0].pacing).toBe('fixed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Switch to flexible' }));
    await waitFor(async () => expect((await service.enrollments())[0].pacing).toBe('flexible'));
  });

  it('edit mode: pause and the collapsed all-plans settings', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const detail = await service.detail(e.id);
    render(<Harness mode={{ kind: 'edit', detail }} onClose={() => {}} />);
    expect(screen.getByText('Settings for all plans').closest('details')).not.toHaveAttribute('open');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pause plan' }));
    await waitFor(async () => expect((await service.enrollments())[0].status).toBe('paused'));
  });

  describe('Start at', () => {
    it('Day N starts part-way: the start date is hidden and days before it are read', async () => {
      const { service } = installTestService();
      const plan = (await service.library()).find((p) => p.key === 'stock:gospels-30')!;
      const onStarted = vi.fn();
      render(<Harness mode={{ kind: 'start', plan }} onClose={() => {}} onStarted={onStarted} />);
      const user = userEvent.setup();
      expect(screen.getByRole('radio', { name: 'Day 1' })).toBeChecked();
      expect(screen.queryByRole('radio', { name: /calendar day/ })).not.toBeInTheDocument();
      const input = screen.getByLabelText('Start day number');
      await user.clear(input);
      await user.type(input, '10');
      expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^Start Reading Plan/ }));
      await waitFor(() => expect(onStarted).toHaveBeenCalled());
      const e = (await service.enrollments())[0];
      const done = await service.completions(e.id);
      expect(new Set(done.map((c) => c.day))).toEqual(new Set(Array.from({ length: 9 }, (_, i) => i + 1)));
      expect(done.every((c) => c.via === 'bulk')).toBe(true);
    });

    it('an out-of-range day disables Start', async () => {
      const { service } = installTestService();
      const plan = (await service.library()).find((p) => p.key === 'stock:gospels-30')!;
      render(<Harness mode={{ kind: 'start', plan }} onClose={() => {}} />);
      const user = userEvent.setup();
      const input = screen.getByLabelText('Start day number');
      await user.clear(input);
      await user.type(input, '99');
      expect(screen.getByRole('button', { name: /^Start Reading Plan/ })).toBeDisabled();
    });

    it("offers today's calendar day for a 365-day plan read every day", async () => {
      const { service } = installTestService(new Date(2026, 1, 1, 12, 0));
      const plan = (await service.library()).find((p) => p.dayCount === 365 || p.dayCount === 366)!;
      const onStarted = vi.fn();
      render(<Harness mode={{ kind: 'start', plan }} onClose={() => {}} onStarted={onStarted} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('radio', { name: /calendar day \(Day 32\)/ }));
      await user.click(screen.getByRole('button', { name: /^Start Reading Plan/ }));
      await waitFor(() => expect(onStarted).toHaveBeenCalled());
      const e = (await service.enrollments())[0];
      expect((await service.completions(e.id)).length).toBeGreaterThan(0);
    });
  });
});
