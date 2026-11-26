import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import { useReadingPlanNavStore, resetReadingPlanNavForTests } from '../useReadingPlanNavStore';
import ReadingPlanVerseBlocks, { activeEndModel } from './ReadingPlanVerseBlocks';
import { openPlanReading, resetActiveReadingForTests, useActiveReadingStore } from '../useActiveReadingStore';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
const openApp = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../apps/appHost', async (importOriginal) => ({ ...(await importOriginal<object>()), openApp: (...a: unknown[]) => openApp(...a) }));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));
const navigate = vi.fn();
vi.mock('../../../stores/crossStoreBridge', () => ({ navigateToVerseInPrimary: (...a: unknown[]) => navigate(...a) }));

const { vid } = ReadingPlans;

/** The reader's loop in miniature: before / after blocks around each verse of a chapter. */
const Chapter = ({ ids }: { ids: number[] }) => (
  <div>
    {ids.map((id, i) => (
      <React.Fragment key={id}>
        <ReadingPlanVerseBlocks verseId={id} prevVerseId={ids[i - 1] ?? null} nextVerseId={ids[i + 1] ?? null} position="before" inParagraph={false} />
        <p data-testid={`v${id}`}>verse {id}</p>
        <ReadingPlanVerseBlocks verseId={id} prevVerseId={ids[i - 1] ?? null} nextVerseId={ids[i + 1] ?? null} position="after" inParagraph={false} />
      </React.Fragment>
    ))}
  </div>
);
import React from 'react';

const seq = (b: number, c: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => vid(b, c, from + i));

async function setup() {
  const { service } = installTestService();
  // A one-passage-per-day plan and a two-passage day, started today (flexible).
  const plan = await service.createPlan({ name: 'Mid', scope: [{ start: vid(1, 1, 3), end: vid(1, 1, 9) }, { start: vid(43, 3, 1), end: vid(43, 3, 4) }], order: 'as-listed', pace: { by: 'days', days: 2 }, split: 'verse' });
  const e = await service.startPlan(plan.key);
  return { service, e, plan };
}

describe('start / end of reading blocks', () => {
  beforeEach(() => { navigate.mockClear(); });
  afterEach(() => { uninstallTestService(); resetActiveReadingForTests(); resetReadingPlanNavForTests(); });

  it('shows nothing when no reading was opened from a plan', async () => {
    await setup();
    render(<Chapter ids={seq(1, 1, 1, 10)} />);
    expect(screen.queryByTestId('reading-plan-start-block')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reading-plan-end-block')).not.toBeInTheDocument();
  });

  it('puts the start block before the mid-chapter first verse and the end block after the last', async () => {
    const { e, plan } = await setup();
    const reading = plan.days[0].readings[0];
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading });
    const start = await screen.findByTestId('reading-plan-start-block').catch(() => null);
    expect(start).toBeNull(); // not rendered before a chapter is drawn
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    const startBlock = await screen.findByTestId('reading-plan-start-block');
    expect(startBlock).toHaveTextContent(/Reading plan · Mid · Day 1 · start of reading/);
    expect(startBlock.nextElementSibling).toHaveAttribute('data-testid', `v${reading.start}`);
    const endBlock = await screen.findByTestId('reading-plan-end-block');
    expect(endBlock.previousElementSibling).toHaveAttribute('data-testid', `v${reading.end}`);
    expect(navigate).toHaveBeenCalledWith(reading.start);
  });

  it('last reading of the day: Mark as read, then "Day 1 done" and a Read ahead link; the checkbox stays for undo', async () => {
    const { service, e, plan } = await setup();
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: plan.days[0].readings[0] });
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    const user = userEvent.setup();
    const box = await screen.findByRole('checkbox', { name: /^Mark .* as read$/ });
    expect(box).not.toBeChecked();
    expect(within(screen.getByTestId('reading-plan-end-block')).getByText(/^Genesis 1:3/)).toBeInTheDocument();
    // Rendering never ticks.
    expect(await service.dayProgress(e.id, 1)).toEqual([]);
    expect(screen.queryByText('Day 1 done')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read ahead/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([0]));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /^Mark .* as read$/ })).toBeChecked());
    expect(screen.getByText('Marked as read')).toBeInTheDocument();
    expect(await screen.findByText('Day 1 done')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read ahead: Day 2' })).toBeInTheDocument();
    // The button is gone: focus must sit on the checkbox, not fall to <body> (the reader would scroll to the top).
    expect(screen.getByRole('checkbox')).toHaveFocus();
    expect(screen.getByRole('checkbox').closest('label')).toHaveClass('kth-check--success');
    await user.click(screen.getByRole('checkbox'));
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([]));
    expect(await screen.findByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
  });

  it('is drawn for a reading of today even when none was opened from the plan, ticked or not', async () => {
    const { service, e, plan } = await setup();
    expect(useActiveReadingStore.getState().info).toBeNull();
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    const reading = plan.days[0].readings[0];
    const block = await screen.findByTestId('reading-plan-end-block');
    expect(block.previousElementSibling).toHaveAttribute('data-testid', `v${reading.end}`);
    expect(screen.queryByTestId('reading-plan-start-block')).not.toBeInTheDocument();
    await service.setReadingDone(e.id, 1, 0, true);
    // A ticked reading keeps its end block only while it is the active one (not all day in every pane).
    await waitFor(() => expect(screen.queryByTestId('reading-plan-end-block')).not.toBeInTheDocument());
    expect(await service.dayProgress(e.id, 1)).toEqual([0]);
  });

  it('marking from a block without an active reading activates it first', async () => {
    const { e } = await setup();
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(useActiveReadingStore.getState().ref).toMatchObject({ enrollmentId: e.id, day: 1, index: 0 }));
  });

  it('reflects a tick made elsewhere in the plan views', async () => {
    const { service, e, plan } = await setup();
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: plan.days[0].readings[0] });
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    await screen.findByRole('button', { name: 'Mark as read' });
    await service.setReadingDone(e.id, 1, 0, true);
    expect(await screen.findByText('Marked as read')).toBeInTheDocument();
    await service.setReadingDone(e.id, 1, 0, false);
    expect(await screen.findByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
  });

  it('View reading plan asks the Reading plans app to highlight this reading', async () => {
    const { e, plan } = await setup();
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: plan.days[0].readings[0] });
    openApp.mockClear();
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'View reading plan' }));
    expect(useReadingPlanNavStore.getState().request).toMatchObject({ enrollmentId: e.id, day: 1, index: 0 });
    expect(openApp).toHaveBeenCalledWith('reading-plans');
  });

  it('Read ahead opens the first reading of the next day', async () => {
    const { service, e, plan } = await setup();
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: plan.days[0].readings[0] });
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mark as read' }));
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([0]));
    await user.click(await screen.findByRole('button', { name: 'Read ahead: Day 2' }));
    const next = plan.days[1].readings[0];
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(next.start));
    await waitFor(() => expect(useActiveReadingStore.getState().info).toMatchObject({ day: 2, index: 0 }));
  });

  it('Mark read and continue ticks the reading, then opens the next due reading of the day', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:mcheyne');
    const plan = await service.planFor(e);
    const [first, second] = plan.days[0].readings;
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: first });
    const { vid: v } = ReadingPlans;
    const f = ReadingPlans.splitVid(first.end);
    render(<Chapter ids={[first.end, v(f.book, f.chapter, f.verse + 1)]} />);
    const btn = await screen.findByRole('button', { name: /^Mark read and continue: / });
    expect(await service.dayProgress(e.id, 1)).toEqual([]);
    await userEvent.setup().click(btn);
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([0]));
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(second.start));
    await waitFor(() => expect(useActiveReadingStore.getState().info).toMatchObject({ day: 1, index: 1 }));
  });

  it('offers the next passage of the same day on a multi-passage day', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:mcheyne');
    const plan = await service.planFor(e);
    const first = plan.days[0].readings[0];
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: first });
    await waitFor(() => expect(useActiveReadingStore.getState().info?.next).toMatchObject({ day: 1, index: 1 }));
    expect(useActiveReadingStore.getState().info?.readingCount).toBeGreaterThan(1);
    render(<Chapter ids={[first.start, first.end]} />);
    expect(await screen.findByTestId('reading-plan-start-block')).toHaveTextContent(/passage 1 of/);
  });

  it('a read-ahead reading stops at its own day: next never chains into the next day', () => {
    const reading = { start: vid(1, 1, 1), end: vid(1, 1, 5) };
    const info = {
      enrollmentId: 'e', planKey: 'k', planName: 'P', day: 3, index: 0, dayCount: 10, readingCount: 1, reading, done: false,
      next: { day: 4, index: 0, reading },
    } as never;
    expect(activeEndModel(info, 1, 1)).toMatchObject({ next: null, nextDay: 4 });
    expect(activeEndModel({ ...(info as object), next: { day: 3, index: 1, reading } } as never, 1, 1).next).toMatchObject({ day: 3, index: 1 });
  });
});
