import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enT, enLocalizer } from '../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import ReadingPlanBar, { resetReadingPlanBarForTests } from './ReadingPlanBar';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

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
    expect(await screen.findByText(/Today's reading \(The Gospels in 30 days\): Matthew 1/)).toBeInTheDocument();
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
});
