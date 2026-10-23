import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import ReadingPlanVerseBlocks from './ReadingPlanVerseBlocks';
import { openPlanReading, resetActiveReadingForTests, useActiveReadingStore } from '../useActiveReadingStore';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
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
  afterEach(() => { uninstallTestService(); resetActiveReadingForTests(); });

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

  it('marks and unmarks from the end block, syncing to the plan', async () => {
    const { service, e, plan } = await setup();
    const reading = plan.days[0].readings[0];
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading });
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mark as read' }));
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([0]));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByText('Marked as read ✓')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await service.dayProgress(e.id, 1)).toEqual([]));
    expect(await screen.findByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
  });

  it('reflects a tick made elsewhere in the plan views', async () => {
    const { service, e, plan } = await setup();
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: plan.days[0].readings[0] });
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    await screen.findByRole('button', { name: 'Mark as read' });
    await service.setReadingDone(e.id, 1, 0, true);
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    await service.setReadingDone(e.id, 1, 0, false);
    expect(await screen.findByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
  });

  it('Next reading opens the next passage and swaps the blocks', async () => {
    const { e, plan } = await setup();
    openPlanReading({ enrollmentId: e.id, day: 1, index: 0, reading: plan.days[0].readings[0] });
    render(<Chapter ids={seq(1, 1, 1, 12)} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /^Next reading: / }));
    const next = plan.days[1].readings[0];
    expect(navigate).toHaveBeenLastCalledWith(next.start);
    await waitFor(() => expect(useActiveReadingStore.getState().info).toMatchObject({ day: 2, index: 0 }));
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
});
