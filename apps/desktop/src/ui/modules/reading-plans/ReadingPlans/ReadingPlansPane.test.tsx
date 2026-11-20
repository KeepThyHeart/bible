import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import ReadingPlansPane from './ReadingPlansPane';
import { useActiveReadingStore, resetActiveReadingForTests } from '../useActiveReadingStore';
import { useReadingPlanNavStore } from '../useReadingPlanNavStore';

vi.mock('../../../services/localizedReferenceParser', () => ({ ensureReferenceLocales: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));
const navigate = vi.fn();
vi.mock('../../../stores/crossStoreBridge', () => ({ navigateToVerseInPrimary: (...a: unknown[]) => navigate(...a) }));
vi.mock('./ReadingPlanDetail', () => ({
  default: (p: { enrollmentId: string; highlight?: { day: number; index: number } | null; onBack: () => void; onOpenSettings: () => void }) => (
    <div data-testid="detail-stub" data-highlight={p.highlight ? `${p.highlight.day}:${p.highlight.index}` : ''}>
      <button type="button" onClick={p.onBack}>Back</button>
      <button type="button" onClick={p.onOpenSettings}>Stub settings</button>
    </div>
  ),
}));
vi.mock('./PlanEditorView', () => ({
  default: (p: { planKey: string | null; onClose: () => void }) => (
    <div data-testid="editor-stub">{String(p.planKey)}<button type="button" onClick={p.onClose}>Back</button></div>
  ),
}));

const GOSPELS = 'The Gospels in 30 days';

describe('ReadingPlansPane', () => {
  beforeEach(() => { navigate.mockClear(); });
  afterEach(() => { uninstallTestService(); resetActiveReadingForTests(); });

  it('has an h1 heading that can take focus', async () => {
    installTestService();
    render(<ReadingPlansPane />);
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(h1).toHaveTextContent('Reading plans');
  });

  it('goes from the empty state to Add, starts a plan in the dialog and lands on Home', async () => {
    installTestService();
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    expect(await screen.findByTestId('reading-plans-empty')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add reading plan' }));
    await user.click(await screen.findByRole('button', { name: `Start Reading Plan: ${GOSPELS}` }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Which days of the week do you want to follow this plan?')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(7);
    await user.click(within(dialog).getByRole('button', { name: `Start Reading Plan: ${GOSPELS}` }));

    expect(await screen.findByRole('heading', { level: 2, name: GOSPELS })).toBeInTheDocument();
    expect(screen.getByText('Day 1 of 30')).toBeInTheDocument();
    expect(screen.getByTestId('plan-day-current')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: /^Start reading: / })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('ticking the day moves on and keeps the finished day as the previous card; undo works', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    const current = await screen.findByTestId('plan-day-current');
    await user.click(within(current).getAllByRole('checkbox')[0]);
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([0]));
    expect(await screen.findByText('Day 2 of 30')).toBeInTheDocument();
    const previous = screen.getByTestId('plan-day-previous');
    expect(within(previous).getByText('Day 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Continue reading: / })).toBeInTheDocument();
    await user.click(within(previous).getAllByRole('checkbox')[0]);
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([]));
    expect(await screen.findByText('Day 1 of 30')).toBeInTheDocument();
  });

  it('the primary button opens the reading without ticking it', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await user.click(await screen.findByRole('button', { name: /^Start reading: / }));
    expect(navigate).toHaveBeenCalledWith(expect.any(Number));
    expect(await service.dayProgress(e.id, 1)).toEqual([]);
    expect(useActiveReadingStore.getState().ref).toMatchObject({ enrollmentId: e.id, day: 1, index: 0 });
  });

  it('shows tabs only with two or more plans and switches between them', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await screen.findByTestId('plan-home');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    await service.startPlan('stock:nt-90');
    await act(async () => {});
    const tabs = await screen.findAllByRole('tab');
    expect(tabs).toHaveLength(2);
    await user.click(screen.getByRole('tab', { name: 'New Testament in 90 days' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'New Testament in 90 days' })).toBeInTheDocument();
  });

  it('a fixed plan started in the past shows the behind notice; Switch to flexible asks first', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30', { startDate: '2026-09-25', pacing: 'fixed' });
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    expect(await screen.findByText('You are 6 days behind schedule')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to flexible' }));
    const box = await screen.findByRole('alertdialog');
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect((await service.enrollments())[0].pacing).toBe('fixed');
    await user.click(screen.getByRole('button', { name: 'Switch to flexible' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Switch to flexible' }));
    await waitFor(async () => expect((await service.enrollments())[0].pacing).toBe('flexible'));
    expect(e.id).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('You are 6 days behind schedule')).not.toBeInTheDocument());
  });

  it('Plan settings edits the plan on Save, and Remove asks in a message box', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await user.click(await screen.findByRole('button', { name: 'Plan settings' }));
    const dialog = await screen.findByRole('dialog');
    const sun = within(dialog).getByRole('checkbox', { name: 'Sun' });
    expect(sun).toBeChecked();
    await user.click(sun);
    // Nothing applied until Save.
    expect((await service.enrollments())[0].readingDays).toHaveLength(7);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await service.enrollments())[0].readingDays).toEqual([1, 2, 3, 4, 5, 6]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Plan settings' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove plan…' }));
    const box = await screen.findByRole('alertdialog');
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(await service.enrollments()).toHaveLength(1);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove plan…' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove plan' }));
    await waitFor(async () => expect(await service.enrollments()).toHaveLength(0));
    expect(await screen.findByTestId('reading-plans-empty')).toBeInTheDocument();
  });

  it('leads with the scheduled finish at first and the estimated finish once there is a pace', async () => {
    const { service, setNow } = installTestService(new Date(2026, 9, 1, 12, 0));
    const e = await service.startPlan('stock:gospels-30');
    const first = render(<ReadingPlansPane />);
    expect(await screen.findByText(/^Scheduled finish: /)).toBeInTheDocument();
    expect(screen.queryByText(/^Estimated finish: /)).not.toBeInTheDocument();
    first.unmount();
    for (const [d, day] of [[1, 1], [2, 2], [3, 3]] as const) {
      setNow(new Date(2026, 9, d, 12, 0));
      await service.setReadingDone(e.id, day, 0, true);
    }
    setNow(new Date(2026, 9, 4, 12, 0));
    render(<ReadingPlansPane />);
    expect(await screen.findByText(/^Estimated finish: /)).toBeInTheDocument();
  });

  it('opens the plan view on a navigation request', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await screen.findByTestId('plan-home');
    act(() => { useReadingPlanNavStore.getState().show({ enrollmentId: e.id, day: 3, index: 0 }); });
    const stub = await screen.findByTestId('detail-stub');
    expect(stub).toHaveAttribute('data-highlight', '3:0');
    await user.click(within(stub).getByRole('button', { name: 'Back' }));
    expect(await screen.findByTestId('plan-home')).toBeInTheDocument();
  });

  it('opens the editor from Add and returns to Add with Back', async () => {
    installTestService();
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await user.click(await screen.findByRole('button', { name: 'Add reading plan' }));
    await user.click(await screen.findByRole('button', { name: 'Create custom plan' }));
    expect(await screen.findByTestId('editor-stub')).toHaveTextContent('null');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Add a reading plan' })).toBeInTheDocument();
  });

  it('deletes one of your own plans through a message box', async () => {
    const { service } = installTestService();
    const plan = await service.savePlan({ name: 'Mine', days: [{ readings: [{ start: 1001001, end: 1001031 }] }] } as never);
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await user.click(await screen.findByRole('button', { name: 'Add reading plan' }));
    await user.click(await screen.findByRole('button', { name: 'Delete Mine' }));
    const box = await screen.findByRole('alertdialog');
    expect(within(box).getByText(/Delete the plan Mine\?/)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Delete plan' }));
    await waitFor(async () => expect((await service.library()).some((p) => p.key === plan.key)).toBe(false));
    expect(screen.getByRole('heading', { name: 'Add a reading plan' })).toBeInTheDocument();
  });

  it('docked in Study it leaves the reader\'s request to the app, and resets when its app is hidden', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<div data-app="study"><ReadingPlansPane /></div>);
    await screen.findByTestId('plan-home');
    useReadingPlanNavStore.getState().show({ enrollmentId: e.id, day: 1, index: 0 });
    await new Promise((r) => setTimeout(r, 50));
    expect(useReadingPlanNavStore.getState().request).not.toBeNull();
    expect(screen.getByTestId('plan-home')).toBeInTheDocument();
    useReadingPlanNavStore.getState().consume();
    await user.click(screen.getByRole('button', { name: 'Plan settings' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    window.dispatchEvent(new Event('app:will-hide'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('plan-home')).toBeInTheDocument();
  });
});
