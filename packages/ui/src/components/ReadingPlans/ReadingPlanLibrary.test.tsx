import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReadingPlans } from '@bible/core/browser';
import { ReadingPlanLibrary } from './ReadingPlanLibrary';

const plans: ReadingPlans.PlanSummary[] = [
  { key: 'stock:bible-365', version: 1, name: 'Bible in a year', description: 'Everything.', source: 'stock', dayCount: 365, verseCount: 31102, trackCount: 1 },
  { key: 'user:abc', version: 1, name: 'Mine', source: 'user', dayCount: 10, verseCount: 800, trackCount: 4 },
];

describe('ReadingPlanLibrary', () => {
  it('lists plans with summary, tracks and only offers delete for user plans', async () => {
    const onStart = vi.fn(); const onDelete = vi.fn(); const onPreview = vi.fn();
    render(<ReadingPlanLibrary plans={plans} onStart={onStart} onDelete={onDelete} onPreview={onPreview} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Bible in a year');
    expect(items[0]).toHaveTextContent('365 days · about 11 min a day');
    expect(items[1]).toHaveTextContent('10 days · about 10 min a day');
    expect(items[1]).toHaveTextContent('4 tracks');
    expect(within(items[0]).queryByRole('button', { name: /Delete/ })).toBeNull();
    const user = userEvent.setup();
    await user.click(within(items[0]).getByRole('button', { name: 'Start Bible in a year' }));
    expect(onStart).toHaveBeenCalledWith('stock:bible-365');
    await user.click(within(items[1]).getByRole('button', { name: 'Delete Mine' }));
    expect(onDelete).toHaveBeenCalledWith('user:abc');
    await user.click(within(items[1]).getByRole('button', { name: 'Preview Mine' }));
    expect(onPreview).toHaveBeenCalledWith('user:abc');
  });

  it('uses nameOf/descriptionOf and shows an empty message', () => {
    const { rerender } = render(<ReadingPlanLibrary plans={plans} nameOf={(p) => `L:${p.name}`} descriptionOf={() => 'Localized'} onStart={vi.fn()} />);
    expect(screen.getByText('L:Mine')).toBeInTheDocument();
    expect(screen.getAllByText('Localized')).toHaveLength(2);
    rerender(<ReadingPlanLibrary plans={[]} onStart={vi.fn()} />);
    expect(screen.getByText('No reading plans yet.')).toBeInTheDocument();
  });
});
