import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import ReadingPlanBar, { resetReadingPlanBarForTests } from './ReadingPlanBar';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

describe('ReadingPlanBar', () => {
  beforeEach(() => { resetReadingPlanBarForTests(); });
  afterEach(() => { uninstallTestService(); });

  it('shows nothing when there are no plans', async () => {
    installTestService();
    render(<ReadingPlanBar currentBook={40} currentChapter={1} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('reading-plan-bar')).not.toBeInTheDocument();
  });

  it("shows for an overlapping chapter and 'Mark read' ticks it", async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    render(<ReadingPlanBar currentBook={40} currentChapter={1} />);
    expect(await screen.findByText(/Today's reading \(The Gospels in 30 days\): Matthew 1-5 · chapter 1 of 5/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    const enrollment = (await service.enrollments())[0];
    await waitFor(async () => expect(await service.dayProgress(enrollment.id, 1)).toEqual([0]));
    await waitFor(() => expect(screen.queryByTestId('reading-plan-bar')).not.toBeInTheDocument());
  });

  it('is hidden for a chapter that is not today\'s reading, and can be dismissed', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    const { rerender } = render(<ReadingPlanBar currentBook={43} currentChapter={21} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('reading-plan-bar')).not.toBeInTheDocument();
    rerender(<ReadingPlanBar currentBook={40} currentChapter={1} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('reading-plan-bar')).not.toBeInTheDocument();
  });

  it('covers the middle of a reading, not the chapter it ends in (that gets the end block)', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30');
    const { rerender } = render(<ReadingPlanBar currentBook={40} currentChapter={2} />);
    expect(await screen.findByText(/Matthew 1-5 · chapter 2 of 5/)).toBeInTheDocument();
    rerender(<ReadingPlanBar currentBook={40} currentChapter={5} />);
    await waitFor(() => expect(screen.queryByTestId('reading-plan-bar')).not.toBeInTheDocument());
  });

  it('lists the same readings as the plan store focus (a fixed plan three days behind shows day 1, not today)', async () => {
    const { service, setNow } = installTestService(new Date(2026, 9, 1, 12, 0));
    const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
    setNow(new Date(2026, 9, 4, 12, 0));
    const view = (await service.todayViews())[0];
    const [first] = ReadingPlans.todaysReadings(view);
    expect(first.day).toBe(1);
    const span = ReadingPlans.chapterSpan(first.reading);
    render(<ReadingPlanBar currentBook={span.first.book} currentChapter={span.first.chapter} />);
    expect(await screen.findByTestId('reading-plan-bar')).toHaveTextContent(`chapter 1 of ${span.count}`);
    cleanup();
    // Today's own scheduled day (4) is not on the bar while day 1 is the focus.
    const day4 = ReadingPlans.chapterSpan((await service.detail(e.id)).plan.days[3].readings[0]);
    render(<ReadingPlanBar currentBook={day4.last.book} currentChapter={day4.last.chapter} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('reading-plan-bar')).not.toBeInTheDocument();
  });
});
