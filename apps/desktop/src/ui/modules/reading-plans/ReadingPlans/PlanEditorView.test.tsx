import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getBookName, ReadingPlans } from '@bible/core/browser';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import PlanEditorView from './PlanEditorView';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

vi.mock('../../../services/localizedReferenceParser', () => ({ ensureReferenceLocales: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

const { vid } = ReadingPlans;

const labels = { bookName: (b: number) => getBookName(b) } as unknown as ReadingPlanLabelSet;

const onClose = vi.fn();
const onSaved = vi.fn();
const onError = vi.fn();

function renderEditor(planKey: string | null = null) {
  return render(<PlanEditorView planKey={planKey} labels={labels} onClose={onClose} onSaved={onSaved} onError={onError} />);
}

async function addPassage(user: ReturnType<typeof userEvent.setup>, day: number, text: string) {
  // An empty day shows its picker at once; a day with passages shows an "add" link first.
  const link = await screen.findAllByRole('button', { name: `Add a passage to day ${day}` }).catch(() => []);
  if (link.length > 0) await user.click(link[0]);
  const box = await screen.findByRole('combobox', { name: `Add a passage to day ${day}` });
  await user.type(box, `${text}{Enter}`);
}

describe('PlanEditorView', () => {
  beforeEach(() => { onClose.mockClear(); onSaved.mockClear(); onError.mockClear(); });
  afterEach(() => uninstallTestService());

  it('a new plan starts with an empty day 1; typing John 1-3 and Enter adds it', async () => {
    installTestService();
    const user = userEvent.setup();
    renderEditor();
    await addPassage(user, 1, 'John 1-3');
    expect(await screen.findByRole('button', { name: /^Remove John 1-3 from day 1$/ })).toBeInTheDocument();
  });

  it('builds a plan by hand and saves it', async () => {
    const { service } = installTestService();
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText('Plan name'), 'My three days');
    await addPassage(user, 1, 'John 1-3');
    await addPassage(user, 1, 'Psalm 23');
    await user.click(screen.getByRole('button', { name: '+ Add day' }));
    await addPassage(user, 2, 'John 3:16');
    await user.click(screen.getByRole('button', { name: '+ Add day' }));
    await addPassage(user, 3, 'Romans 8');
    expect(screen.getByText(/3 days · 4 passages · about \d+ min a day/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [plan, isNew] = onSaved.mock.calls[0] as [ReadingPlans.PlanDefinition, boolean];
    expect(isNew).toBe(true);
    const saved = (await service.library()).find((p) => p.key === plan.key);
    expect(saved?.name).toBe('My three days');
    const stored = await service.getPlan(plan.key);
    expect(stored?.days).toEqual([
      { readings: [{ start: vid(43, 1, 1), end: vid(43, 3, 36) }, { start: vid(19, 23, 1), end: vid(19, 23, 6) }] },
      { readings: [{ start: vid(43, 3, 16), end: vid(43, 3, 16) }] },
      { readings: [{ start: vid(45, 8, 1), end: vid(45, 8, 39) }] },
    ]);
  });

  it('blocks saving with no passages and names the empty days', async () => {
    const { service } = installTestService();
    const user = userEvent.setup();
    renderEditor();
    await addPassage(user, 1, 'John 3');
    await user.click(screen.getByRole('button', { name: '+ Add day' }));
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('day 2');
    expect(onSaved).not.toHaveBeenCalled();
    expect((await service.library()).some((p) => p.source === 'user')).toBe(false);
  });

  it('asks before auto-fill replaces hand-made days, and appends after them otherwise', async () => {
    installTestService();
    const user = userEvent.setup();
    renderEditor();
    await addPassage(user, 1, 'John 1-3');
    await user.click(screen.getByRole('button', { name: 'Fill automatically…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Gospels' }));
    await user.click(within(dialog).getByRole('button', { name: 'Replace all days' }));
    const box = await screen.findByRole('alertdialog');
    expect(within(box).getByText('The 1 day you have now will be removed.')).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Remove John 1-3 from day 1' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add after day 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(/^31 days · /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove John 1-3 from day 1' })).toBeInTheDocument();
  });

  it('fills 30 Gospel days automatically, then a day can be edited before saving', async () => {
    const { service } = installTestService();
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Fill automatically…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Gospels' }));
    const days = within(dialog).getByLabelText('Spread over this many days');
    await user.clear(days);
    await user.type(days, '30');
    await user.click(within(dialog).getByRole('button', { name: /^Fill plan$|^Replace all days$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(/^30 days · /)).toBeInTheDocument();
    const remove = screen.getAllByRole('button', { name: /^Remove .* from day 30$/ })[0];
    const total = screen.getAllByRole('button', { name: /^Remove .* from day 30$/ }).length;
    expect(total).toBeGreaterThan(0);
    await user.click(remove);
    await addPassage(user, 30, 'Jude 1');
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const plan = (onSaved.mock.calls[0] as [ReadingPlans.PlanDefinition])[0];
    expect((await service.getPlan(plan.key))?.days).toHaveLength(30);
    expect(plan.name).toBe('My reading plan');
  });

  it('edits an existing plan (version 2) and warns when it is followed', async () => {
    const { service } = installTestService();
    const plan = await service.savePlan({ name: 'Mine', days: [{ readings: [{ start: vid(43, 3, 1), end: vid(43, 3, 36) }] }] });
    await service.startPlan(plan.key);
    const user = userEvent.setup();
    renderEditor(plan.key);
    expect(await screen.findByDisplayValue('Mine')).toBeInTheDocument();
    expect(screen.getByText(/You are following this plan/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Add day' }));
    await addPassage(user, 2, 'John 4');
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][1]).toBe(false);
    const stored = await service.getPlan(plan.key);
    expect(stored?.version).toBe(2);
    expect(stored?.days).toHaveLength(2);
  });

  it('asks before discarding changes, and leaves at once when nothing changed', async () => {
    installTestService();
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.type(screen.getByLabelText('Plan name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    const box = await screen.findByRole('alertdialog');
    await user.click(within(box).getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
