import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import ReadingPlansPane, { ReadingPlansApp } from './ReadingPlansPane';
import { useActiveReadingStore, resetActiveReadingForTests } from '../useActiveReadingStore';
import { useReadingPlanNavStore, resetReadingPlanNavForTests } from '../useReadingPlanNavStore';

vi.mock('../../../services/localizedReferenceParser', () => ({ ensureReferenceLocales: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));
const openBeside = vi.fn().mockResolvedValue(undefined);
vi.mock('../openBeside', () => ({ openReadingPlansBeside: () => openBeside() }));
const navigate = vi.fn();
vi.mock('../../../stores/crossStoreBridge', () => ({ navigateToVerseInPrimary: (...a: unknown[]) => navigate(...a) }));
vi.mock('./ReadingPlanDetail', () => ({
  default: (p: { enrollmentId: string; highlight?: { day: number; index: number } | null; onBack: () => void; onOpenSettings: () => void }) => (
    <div data-testid="detail-stub" data-id={p.enrollmentId} data-highlight={p.highlight ? `${p.highlight.day}:${p.highlight.index}` : ''}>
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
const NT = 'New Testament in 90 days';

const agendaTab = async () => screen.findByTestId('agenda-tab');
const tiles = () => screen.queryAllByTestId('agenda-plan-tile');
const tile = (name: string) => {
  const t = tiles().find((r) => within(r).queryByRole('button', { name }));
  if (!t) throw new Error(`no agenda tile for ${name}`);
  return t;
};
/** The readings of one date in the Agenda list. */
const listDate = (date: string) => {
  const el = screen.getByTestId('agenda-list').querySelector(`[data-date="${date}"]`);
  if (!el) throw new Error(`no list date ${date}`);
  return el as HTMLElement;
};

/** Open the Reschedule dialog from the behind line in Agenda. */
async function openReschedule(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId('behind-line');
  await user.click(screen.getByRole('button', { name: 'Reschedule' }));
  return screen.findByRole('dialog');
}

describe('ReadingPlansPane', () => {
  beforeEach(() => { navigate.mockClear(); openBeside.mockClear(); window.localStorage.clear(); });
  afterEach(() => { uninstallTestService(); resetActiveReadingForTests(); resetReadingPlanNavForTests(); window.localStorage.clear(); });

  it('has an h1 heading that can take focus, and the Agenda / Plans / Settings tabs', async () => {
    installTestService();
    render(<ReadingPlansPane />);
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(h1).toHaveTextContent('Reading plans');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Agenda', 'Plans', 'Settings']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('the Settings tab shows the reading-plan settings', async () => {
    installTestService();
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await screen.findByTestId('reading-plans-empty');
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(await screen.findByTestId('settings-group-readingPlans')).toBeInTheDocument();
    expect(screen.queryByTestId('agenda-tab')).not.toBeInTheDocument();
  });

  it('goes from the empty state to Add, starts a plan in the dialog and lands on Agenda with the plan in the table', async () => {
    installTestService();
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    expect(await screen.findByTestId('reading-plans-empty')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add reading plan' }));
    expect(screen.getByRole('tab', { name: 'Plans' })).toHaveAttribute('aria-selected', 'true');
    await user.click(await screen.findByRole('button', { name: `Start Reading Plan: ${GOSPELS}` }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Which days of the week do you want to follow this plan?')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(7);
    await user.click(within(dialog).getByRole('button', { name: `Start Reading Plan: ${GOSPELS}` }));

    const progress = await screen.findByTestId('agenda-progress');
    expect(screen.getByRole('tab', { name: 'Agenda' })).toHaveAttribute('aria-selected', 'true');
    expect(within(progress).getAllByTestId('agenda-plan-tile')).toHaveLength(1);
    expect(within(progress).getByRole('button', { name: GOSPELS })).toBeInTheDocument();
    expect(within(progress).getByRole('progressbar', { name: `${GOSPELS}: Plan progress` })).toBeInTheDocument();
    expect(within(listDate('2026-10-01')).getByRole('checkbox', { name: 'Mark Matthew 1-5 as read' })).not.toBeChecked();
  });

  // Product bug: `headingRef` (ReadingPlansPane.tsx) is no longer attached to anything since the pane moved to
  // `AppPage`, which renders the h1 itself, so focus falls to <body> once the settings dialog closes. Un-skip after
  // the fix.
  it('hands focus to the h1 after a plan was started', async () => {
    installTestService();
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await user.click(await screen.findByRole('button', { name: 'Add reading plan' }));
    await user.click(await screen.findByRole('button', { name: `Start Reading Plan: ${GOSPELS}` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: `Start Reading Plan: ${GOSPELS}` }));
    await screen.findByTestId('agenda-progress');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus());
  });

  it('ticking a reading in the Agenda list ticks it; unticking works', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    const list = await screen.findByTestId('agenda-list');
    await user.click(within(list).getByRole('checkbox', { name: 'Mark Matthew 1-5 as read' }));
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([0]));
    await waitFor(() => expect(within(screen.getByTestId('agenda-list')).getByRole('checkbox', { name: 'Mark Matthew 1-5 as read' })).toBeChecked());
    await user.click(within(screen.getByTestId('agenda-list')).getByRole('checkbox', { name: 'Mark Matthew 1-5 as read' }));
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([]));
  });

  it('opening a reading in the Agenda list opens it without ticking it', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await screen.findByTestId('agenda-list');
    await user.click(within(listDate('2026-10-01')).getByRole('button', { name: 'Open Matthew 1-5' }));
    expect(navigate).toHaveBeenCalledWith(expect.any(Number));
    expect(await service.dayProgress(e.id, 1)).toEqual([]);
    await waitFor(() => expect(useActiveReadingStore.getState().ref).toMatchObject({ enrollmentId: e.id, day: 1, index: 0 }));

    navigate.mockClear();
    await user.click(within(listDate('2026-10-02')).getByRole('button', { name: /^Open / }));
    expect(navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useActiveReadingStore.getState().ref).toMatchObject({ enrollmentId: e.id, day: 2, index: 0 }));
  });

  it('several plans all appear in the Agenda tiles and list', async () => {
    const { service } = installTestService();
    const a = await service.startPlan('stock:gospels-30');
    await service.startPlan('stock:nt-90');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await agendaTab();
    await waitFor(() => expect(tiles()).toHaveLength(2));
    expect(tile(GOSPELS)).toBeInTheDocument();
    expect(tile(NT)).toBeInTheDocument();
    const today = listDate('2026-10-01');
    expect(today).toHaveTextContent(`${GOSPELS} ·`);
    expect(today).toHaveTextContent(`${NT} ·`);
    expect(within(today).getAllByTestId('agenda-reading').length).toBeGreaterThanOrEqual(2);
    // A plan name on its tile opens that plan in the Plans tab.
    await user.click(within(tile(GOSPELS)).getByRole('button', { name: GOSPELS }));
    expect(await screen.findByTestId('detail-stub')).toHaveAttribute('data-id', a.id);
    expect(screen.getByRole('tab', { name: 'Plans' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a paused plan has no Agenda tile; Resume plan in its Plan settings brings it back', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    const b = await service.startPlan('stock:nt-90');
    await service.pause(b.id);
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await agendaTab();
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(tile(GOSPELS)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: NT })).not.toBeInTheDocument();
    // Paused, it lays nothing ahead: today's list is only the other plan's.
    expect(listDate('2026-10-01')).not.toHaveTextContent(NT);

    await user.click(screen.getByRole('tab', { name: 'Plans' }));
    expect((await screen.findAllByTestId('plans-row')).find((r) => within(r).queryByRole('button', { name: NT }))).toHaveTextContent('Paused');
    await user.click(screen.getByRole('button', { name: `Plan settings: ${NT}` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resume plan' }));
    await waitFor(async () => expect((await service.enrollments()).find((e) => e.id === b.id)?.status).toBe('active'));
    await user.click(screen.getByRole('tab', { name: 'Agenda' }));
    await waitFor(() => expect(tiles()).toHaveLength(2));
  });

  it('the reader\'s deep link opens the plan in the Plans tab; Back returns to the Plans list', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    const b = await service.startPlan('stock:nt-90');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await agendaTab();
    act(() => { useReadingPlanNavStore.getState().show({ enrollmentId: b.id, day: 2, index: 0 }); });
    const stub = await screen.findByTestId('detail-stub');
    expect(stub).toHaveAttribute('data-id', b.id);
    expect(stub).toHaveAttribute('data-highlight', '2:0');
    expect(screen.getByRole('tab', { name: 'Plans' })).toHaveAttribute('aria-selected', 'true');
    expect(useReadingPlanNavStore.getState().request).toBeNull();
    await user.click(within(stub).getByRole('button', { name: 'Back' }));
    expect(await screen.findByTestId('plans-tab')).toBeInTheDocument();
    expect(screen.getAllByTestId('plans-row')).toHaveLength(2);
    expect(screen.queryByTestId('detail-stub')).not.toBeInTheDocument();
  });

  it('a deep link that arrives before the pane opens is followed once the data is loaded', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    useReadingPlanNavStore.getState().show({ enrollmentId: e.id, day: 3, index: 0 });
    render(<ReadingPlansPane />);
    expect(await screen.findByTestId('detail-stub')).toHaveAttribute('data-highlight', '3:0');
  });

  it('a fixed plan started in the past shows the behind line; Reschedule > Stop tracking dates asks first', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30', { startDate: '2026-09-25', pacing: 'fixed' });
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    expect(await screen.findByTestId('behind-line')).toHaveTextContent(`${GOSPELS} is 6 days behind schedule.`);
    expect(tile(GOSPELS)).toHaveTextContent('6 days behind');
    const dialog = await openReschedule(user);
    expect(dialog).toHaveTextContent(`Reschedule ${GOSPELS}`);
    expect(dialog).toHaveTextContent('You are 6 days behind schedule');
    await user.click(within(dialog).getByTestId('choice-flexible'));
    const box = await screen.findByRole('alertdialog');
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect((await service.enrollments())[0].pacing).toBe('fixed');
    await user.click(within(await screen.findByRole('dialog')).getByTestId('choice-flexible'));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Switch to flexible' }));
    await waitFor(async () => expect((await service.enrollments())[0].pacing).toBe('flexible'));
    await waitFor(() => expect(screen.queryByTestId('behind-line')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Catch up gradually starts catch-up, and Stop (from Reschedule again) ends it', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30', { startDate: '2026-09-25', pacing: 'fixed' });
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    const dialog = await openReschedule(user);
    await user.click(within(dialog).getByTestId('choice-gradual'));
    await waitFor(async () => expect((await service.enrollments())[0].catchUp).toEqual({ extraPerDay: 1 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const again = await openReschedule(user);
    const on = await within(again).findByTestId('catch-up-on');
    expect(on).toHaveTextContent('Catching up: 1 extra a day');
    await user.click(within(on).getByRole('button', { name: 'Stop' }));
    await waitFor(async () => expect((await service.enrollments())[0].catchUp ?? null).toBeNull());
  });

  it('Move the dates shows the real dates, shifts the schedule, and Undo restores start date and catch-up', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30', { startDate: '2026-09-25', pacing: 'fixed' });
    await service.startCatchUp(e.id);
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    const dialog = await openReschedule(user);
    await user.click(within(dialog).getByTestId('choice-move'));
    const preview = await screen.findByTestId('move-preview');
    expect(preview).toHaveTextContent(/Sep 25, 2026/);
    expect(preview).toHaveTextContent(/Oct 1, 2026/);
    expect((await service.enrollments())[0].startDate).toBe('2026-09-25');
    await user.click(screen.getByTestId('confirm-move'));
    await waitFor(async () => expect((await service.enrollments())[0].startDate).toBe('2026-10-01'));
    expect((await service.enrollments())[0].catchUp ?? null).toBeNull();
    const notice = await screen.findByTestId('moved-notice');
    expect(notice).toHaveTextContent('Sep 25, 2026');
    await waitFor(() => expect(screen.queryByTestId('behind-line')).not.toBeInTheDocument());
    expect(useReadingPlanNavStore.getState().scheduleUndo).toMatchObject({ oldStartDate: '2026-09-25', oldCatchUp: { extraPerDay: 1 }, newStartDate: '2026-10-01' });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await service.enrollments())[0].startDate).toBe('2026-09-25'));
    expect((await service.enrollments())[0].catchUp).toEqual({ extraPerDay: 1 });
    await waitFor(() => expect(screen.queryByTestId('moved-notice')).not.toBeInTheDocument());
    expect(useReadingPlanNavStore.getState().scheduleUndo).toBeNull();
  });

  it('Back in the Move step returns to the choices without moving anything', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30', { startDate: '2026-09-25', pacing: 'fixed' });
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    const dialog = await openReschedule(user);
    await user.click(within(dialog).getByTestId('choice-move'));
    await screen.findByTestId('move-preview');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }));
    expect(await within(screen.getByRole('dialog')).findByTestId('choice-move')).toBeInTheDocument();
    expect((await service.enrollments())[0].startDate).toBe('2026-09-25');
  });

  it('the Undo notice is gone once the schedule was edited since', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30', { startDate: '2026-09-25', pacing: 'fixed' });
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    const dialog = await openReschedule(user);
    await user.click(within(dialog).getByTestId('choice-move'));
    await user.click(await screen.findByTestId('confirm-move'));
    await screen.findByTestId('moved-notice');
    await act(async () => { await service.updateEnrollment(e.id, { startDate: '2026-10-02' }); });
    await waitFor(() => expect(screen.queryByTestId('moved-notice')).not.toBeInTheDocument());
  });

  it('"Open beside the Bible" shows only in the app form and docks the pane', async () => {
    installTestService();
    const user = userEvent.setup();
    const first = render(<ReadingPlansPane />);
    await screen.findByTestId('reading-plans-empty');
    expect(screen.queryByRole('button', { name: 'Open beside the Bible' })).not.toBeInTheDocument();
    first.unmount();
    render(<ReadingPlansApp />);
    await user.click(await screen.findByRole('button', { name: 'Open beside the Bible' }));
    expect(openBeside).toHaveBeenCalledTimes(1);
  });

  it('Plan settings (from the Plans tab) edits the plan on Save, and Remove asks in a message box', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await agendaTab();
    await user.click(screen.getByRole('tab', { name: 'Plans' }));
    const settingsButton = `Plan settings: ${GOSPELS}`;
    await user.click(await screen.findByRole('button', { name: settingsButton }));
    const dialog = await screen.findByRole('dialog');
    const sun = within(dialog).getByRole('checkbox', { name: 'Sun' });
    expect(sun).toBeChecked();
    await user.click(sun);
    // Nothing applied until Save.
    expect((await service.enrollments())[0].readingDays).toHaveLength(7);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await service.enrollments())[0].readingDays).toEqual([1, 2, 3, 4, 5, 6]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: settingsButton }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove plan…' }));
    const box = await screen.findByRole('alertdialog');
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(await service.enrollments()).toHaveLength(1);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove plan…' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove plan' }));
    await waitFor(async () => expect(await service.enrollments()).toHaveLength(0));
    expect(await screen.findByTestId('reading-plans-empty')).toBeInTheDocument();
  });

  it('the full plan view opens from the Plans tab and its settings button opens Plan settings', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await agendaTab();
    await user.click(screen.getByRole('tab', { name: 'Plans' }));
    await user.click(await screen.findByRole('button', { name: `View full plan: ${GOSPELS}` }));
    const stub = await screen.findByTestId('detail-stub');
    expect(stub).toHaveAttribute('data-id', e.id);
    expect(stub).toHaveAttribute('data-highlight', '');
    await user.click(within(stub).getByRole('button', { name: 'Stub settings' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('leaving the Plans tab and coming back starts from its list', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<ReadingPlansPane />);
    await agendaTab();
    await user.click(within(tile(GOSPELS)).getByRole('button', { name: GOSPELS }));
    await screen.findByTestId('detail-stub');
    await user.click(screen.getByRole('tab', { name: 'Agenda' }));
    await screen.findByTestId('agenda-tab');
    await user.click(screen.getByRole('tab', { name: 'Plans' }));
    expect(await screen.findByTestId('plans-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-stub')).not.toBeInTheDocument();
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

  it('docked in Study it leaves the reader\'s request to the app, and resets to Agenda when its app is hidden', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const user = userEvent.setup();
    render(<div data-app="study"><ReadingPlansPane /></div>);
    await agendaTab();
    act(() => { useReadingPlanNavStore.getState().show({ enrollmentId: e.id, day: 1, index: 0 }); });
    await new Promise((r) => setTimeout(r, 50));
    expect(useReadingPlanNavStore.getState().request).not.toBeNull();
    expect(screen.queryByTestId('detail-stub')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Agenda' })).toHaveAttribute('aria-selected', 'true');
    useReadingPlanNavStore.getState().consume();

    await user.click(screen.getByRole('tab', { name: 'Plans' }));
    await user.click(await screen.findByRole('button', { name: `Plan settings: ${GOSPELS}` }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('app:will-hide')); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Agenda' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('agenda-tab')).toBeInTheDocument();
  });

  it('a hidden app also closes an open Reschedule dialog', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30', { startDate: '2026-09-25', pacing: 'fixed' });
    const user = userEvent.setup();
    render(<div data-app="study"><ReadingPlansPane /></div>);
    await openReschedule(user);
    act(() => { window.dispatchEvent(new Event('app:will-hide')); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
