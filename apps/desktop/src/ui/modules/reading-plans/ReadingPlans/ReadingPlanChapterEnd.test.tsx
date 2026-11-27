import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import { resetActiveReadingForTests } from '../useActiveReadingStore';
import ReadingPlanChapterEnd from './ReadingPlanChapterEnd';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../../apps/appHost', async (importOriginal) => ({ ...(await importOriginal<object>()), openApp: vi.fn().mockResolvedValue(undefined) }));

describe('ReadingPlanChapterEnd (readerChapterEnd slot)', () => {
  afterEach(() => { uninstallTestService(); resetActiveReadingForTests(); });

  it('draws nothing without plans', async () => {
    installTestService();
    render(<ReadingPlanChapterEnd book={40} chapter={1} displayMode="study" onNext={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('reading-plan-chapter-end')).not.toBeInTheDocument();
  });

  it('offers "Continue reading" in the middle of a multi-chapter reading, in any mode', async () => {
    const { service } = installTestService();
    await service.startPlan('stock:gospels-30'); // today: Matthew 1-5
    const onNext = vi.fn();
    render(<ReadingPlanChapterEnd book={40} chapter={2} displayMode="standard" onNext={onNext} />);
    const link = await screen.findByTestId('reading-plan-continue');
    expect(link).toHaveTextContent('Continue reading: Matthew 3 (chapter 3 of 5)');
    await userEvent.setup().click(link);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('reading-plan-end-block')).not.toBeInTheDocument();
  });

  it('draws the end block at the last chapter in Study and Parallel, not in Standard (the verse slot does that)', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30');
    const { rerender } = render(<ReadingPlanChapterEnd book={40} chapter={5} displayMode="study" onNext={() => {}} />);
    const block = await screen.findByTestId('reading-plan-end-block');
    expect(block).toHaveTextContent('(chapter 5 of 5)');
    expect(screen.queryByTestId('reading-plan-continue')).not.toBeInTheDocument();
    // Rendering never ticks.
    expect(await service.dayProgress(e.id, 1)).toEqual([]);
    rerender(<ReadingPlanChapterEnd book={40} chapter={5} displayMode="parallel" onNext={() => {}} />);
    expect(screen.getByTestId('reading-plan-end-block')).toBeInTheDocument();
    rerender(<ReadingPlanChapterEnd book={40} chapter={5} displayMode="standard" onNext={() => {}} />);
    expect(screen.queryByTestId('reading-plan-end-block')).not.toBeInTheDocument();
  });
});
