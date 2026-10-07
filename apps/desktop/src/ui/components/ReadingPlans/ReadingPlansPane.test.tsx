import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enT, enLocalizer } from '../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import ReadingPlansPane from './ReadingPlansPane';

let testLocale = 'en';
vi.mock('../../services/localizedReferenceParser', () => ({ ensureReferenceLocales: vi.fn().mockResolvedValue([]) }));
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: testLocale, localizer: enLocalizer }),
}));
vi.mock('../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));
const navigate = vi.fn();
vi.mock('../../stores/crossStoreBridge', () => ({ navigateToVerseInPrimary: (...a: unknown[]) => navigate(...a) }));

describe('ReadingPlansPane', () => {
  beforeEach(() => { navigate.mockClear(); testLocale = 'en'; });
  afterEach(() => { uninstallTestService(); });

  it('shows the empty state and leads to the Plans view', async () => {
    installTestService();
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    expect(await screen.findByText('No reading plan yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose a plan' }));
    expect(await screen.findByRole('heading', { name: 'Plan library' })).toBeInTheDocument();
  });

  it('starts a stock plan from the library and shows it on Today, then ticks a reading', async () => {
    const { service } = installTestService();
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await user.click(await screen.findByRole('button', { name: 'Choose a plan' }));
    await user.click(await screen.findByRole('button', { name: 'Start The Gospels in 30 days' }));
    await user.click(screen.getByRole('button', { name: 'Start plan' }));

    const card = await screen.findByRole('region', { name: 'The Gospels in 30 days' });
    expect(within(card).getByText('Day 1 of 30')).toBeInTheDocument();
    const boxes = within(card).getAllByRole('checkbox');
    await user.click(boxes[0]);
    const enrollment = (await service.enrollments())[0];
    await waitFor(async () => expect(await service.dayProgress(enrollment.id, 1)).toEqual([0]));
    // The only reading of day 1 is read, so the flexible plan moves on to day 2.
    expect(await screen.findByText('Day 2 of 30')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /^Open / })[0]);
    expect(navigate).toHaveBeenCalledWith(expect.any(Number));
  });

  it('shows the behind banner on a fixed plan', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30', { startDate: '2026-09-25', pacing: 'fixed' });
    render(<ReadingPlansPane />);
    expect(await screen.findByText('You are 6 days behind')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reschedule from today' })).toBeInTheDocument();
  });

  it('creates a plan from the builder and lands on Today', { timeout: 30000 }, async () => {
    const { service } = installTestService();
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await user.click(await screen.findByRole('button', { name: 'New plan' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Jude' }));
    const days = screen.getByRole('spinbutton', { name: 'Number of days' });
    await user.clear(days);
    await user.type(days, '1');
    await user.type(screen.getByLabelText('Plan name'), 'Just Jude');
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(await screen.findByRole('region', { name: 'Just Jude' })).toBeInTheDocument();
    expect((await service.enrollments())).toHaveLength(1);
    expect((await service.library()).some((p) => p.name === 'Just Jude')).toBe(true);
  });

  it('gives the builder passage picker the UI locale, loads its reference data and uses the localized labels', async () => {
    testLocale = 'ar';
    installTestService();
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await user.click(await screen.findByRole('button', { name: 'New plan' }));
    const input = screen.getByRole('combobox', { name: enT('readingPlans.builder.addPassage') });
    expect(input.closest('[dir]')).toHaveAttribute('dir', 'rtl');
    expect(input).toHaveAttribute('placeholder', enT('readingPlans.builder.addPassagePlaceholder'));
    const { ensureReferenceLocales } = await import('../../services/localizedReferenceParser');
    expect(ensureReferenceLocales).toHaveBeenCalledWith(['ar']);
  });

  it('opens the plan detail, pauses and removes the plan', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await user.click(await screen.findByRole('button', { name: 'The Gospels in 30 days' }));
    expect(await screen.findByTestId('reading-plan-detail')).toBeInTheDocument();
    expect(screen.getByText('Days read: 0 of 30')).toBeInTheDocument();
    expect(screen.queryByText(/^Streak/)).not.toBeInTheDocument();
    expect(screen.queryByText('Daily reminder')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Day 3, upcoming' }));
    expect(await screen.findByText('Day 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(async () => expect((await service.enrollments())[0].status).toBe('paused'));
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    await user.click(within(screen.getByRole('group', { name: 'Remove' })).getByRole('button', { name: 'Remove' }));
    await waitFor(async () => expect(await service.enrollments()).toHaveLength(0));
  });
});
