import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getBookName, ReadingPlans } from '@bible/core/browser';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import ReadingPlanDetail from './ReadingPlanDetail';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';
import { resetActiveReadingForTests } from '../useActiveReadingStore';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../../stores/crossStoreBridge', () => ({ navigateToVerseInPrimary: vi.fn() }));
vi.mock('../../../apps/appHost', async (importOriginal) => ({ ...(await importOriginal<object>()), openApp: vi.fn().mockResolvedValue(undefined) }));

const { vid } = ReadingPlans;
const labels = {
  formatReading: (r: ReadingPlans.Reading) => ReadingPlans.formatReading(r, getBookName),
  bookName: () => '', trackName: (_id: string, f?: string) => f ?? '', formatDate: (iso: string) => iso,
  localizePlanName: (_k: string, f: string) => f, weekdayNames: [],
} as unknown as ReadingPlanLabelSet;

const onBack = vi.fn();
const onOpenSettings = vi.fn();
const onError = vi.fn();

async function setup() {
  const { service } = installTestService();
  const plan = await service.savePlan({
    name: 'Five',
    days: [1, 2, 3, 4, 5].map((c) => ({ readings: [{ start: vid(43, c, 1), end: vid(43, c, 5) }, { start: vid(19, c, 1), end: vid(19, c, 3) }] })),
  });
  const e = await service.startPlan(plan.key);
  return { service, e };
}

function renderDetail(id: string, highlight?: { day: number; index: number } | null) {
  return render(<ReadingPlanDetail enrollmentId={id} labels={labels} displayName={(_k, f) => f} highlight={highlight}
    onBack={onBack} onOpenSettings={onOpenSettings} onError={onError} />);
}

describe('ReadingPlanDetail', () => {
  beforeEach(() => { onBack.mockClear(); onOpenSettings.mockClear(); onError.mockClear(); });
  afterEach(() => { uninstallTestService(); resetActiveReadingForTests(); });

  it('shows the stats with the scheduled finish while there is little history', async () => {
    const { e } = await setup();
    renderDetail(e.id);
    expect(await screen.findByText('Days read: 0 of 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText(/^Scheduled finish: /)).toBeInTheDocument();
    expect(screen.queryByText(/^Estimated finish/)).not.toBeInTheDocument();
    expect(screen.getByText(/one day of the plan on each of your reading days/)).toBeInTheDocument();
  });

  it('leads with the scheduled finish at first and the estimated finish once there is a pace', async () => {
    const { service, setNow } = installTestService(new Date(2026, 9, 1, 12, 0));
    const e = await service.startPlan('stock:gospels-30');
    const first = renderDetail(e.id);
    expect(await screen.findByText(/^Scheduled finish: /)).toBeInTheDocument();
    expect(screen.queryByText(/^Estimated finish: /)).not.toBeInTheDocument();
    first.unmount();
    for (const [d, day] of [[1, 1], [2, 2], [3, 3]] as const) {
      setNow(new Date(2026, 9, d, 12, 0));
      await service.setReadingDone(e.id, day, 0, true);
    }
    setNow(new Date(2026, 9, 4, 12, 0));
    renderDetail(e.id);
    expect(await screen.findByText(/^Estimated finish: /)).toBeInTheDocument();
  });

  it('ticks a reading through the service and keeps the Home focus row', async () => {
    const { service, e } = await setup();
    const user = userEvent.setup();
    renderDetail(e.id);
    const rows = await screen.findAllByTestId('plan-table-row');
    expect(rows.find((r) => r.getAttribute('data-today') === 'true')).toHaveAttribute('data-day', '1');
    const row1 = rows[0];
    for (const box of within(row1).getAllByRole('checkbox')) await user.click(box);
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([0, 1]));
    // The same stable "today" as Home: ticking does not move the focus day on until the next reading day.
    await waitFor(() => expect(screen.getAllByTestId('plan-table-row')[0].querySelector('input[type="checkbox"]')).toBeChecked());
    expect(screen.getAllByTestId('plan-table-row').find((r) => r.getAttribute('data-today') === 'true')).toHaveAttribute('data-day', '1');
  });

  it('marks and labels the highlighted reading, even when the filter hides read days', async () => {
    const { service, e } = await setup();
    await service.setDayDone(e.id, 3, true);
    renderDetail(e.id, { day: 3, index: 1 });
    expect(await screen.findByText('You just read this')).toBeInTheDocument();
    const marked = document.querySelectorAll('[data-highlight="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].closest('tr')).toHaveAttribute('data-day', '3');
    expect(marked[0].parentElement?.children[1]).toBe(marked[0]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(screen.getByText('You just read this')).toBeInTheDocument();
  });

  it('opens the plan settings and goes back', async () => {
    const { e } = await setup();
    const user = userEvent.setup();
    renderDetail(e.id);
    await user.click(await screen.findByRole('button', { name: 'Plan settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Settings for this plan')).not.toBeInTheDocument();
  });

  it('row menu: mark everything up to here as read', async () => {
    const { service, e } = await setup();
    renderDetail(e.id);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Actions for day 3' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark everything up to here as read' }));
    await waitFor(async () => expect((await service.completions(e.id)).filter((c) => c.day <= 3)).toHaveLength(6));
    expect((await service.completions(e.id)).every((c) => c.via === 'bulk')).toBe(true);
  });

  it('row menu: unread asks first, warns history is lost, and Cancel changes nothing', async () => {
    const { service, e } = await setup();
    await service.setDaysDoneThrough(e.id, 4, true);
    renderDetail(e.id);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Actions for day 2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark everything up to here as unread' }));
    const box = await screen.findByRole('alertdialog');
    expect(box).toHaveTextContent(/record of when you read them is lost/);
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(await service.completions(e.id)).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: 'Actions for day 2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark everything up to here as unread' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Mark as unread' }));
    await waitFor(async () => expect((await service.completions(e.id)).filter((c) => c.day <= 2)).toHaveLength(0));
    expect((await service.completions(e.id)).filter((c) => c.day > 2)).toHaveLength(4);
  });
});
