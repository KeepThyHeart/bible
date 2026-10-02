import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookDistributionStrip } from './BookDistributionStrip';

const formatBook = (b: number) => `Book ${b}`;

describe('BookDistributionStrip', () => {
  it('renders 66 bars with names and counts, empty ones disabled', () => {
    render(<BookDistributionStrip bookCounts={{ 43: 30, 62: 10 }} onSelect={() => {}} formatBook={formatBook} />);
    expect(screen.getAllByRole('button')).toHaveLength(66);
    expect(screen.getByRole('button', { name: 'Book 43: 30' })).toHaveAttribute('title', 'Book 43: 30');
    expect(screen.getByRole('button', { name: 'Book 1: 0' })).toBeDisabled();
  });

  it('scales height by the maximum', () => {
    render(<BookDistributionStrip bookCounts={{ 43: 30, 62: 15 }} onSelect={() => {}} formatBook={formatBook} />);
    const bar = (n: number) => screen.getByRole('button', { name: `Book ${n}: ${n === 43 ? 30 : 15}` }).firstElementChild as HTMLElement;
    expect(bar(43).style.blockSize).toBe('100%');
    expect(bar(62).style.blockSize).toBe('50%');
  });

  it('selects and deselects a book', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<BookDistributionStrip bookCounts={{ 43: 30 }} onSelect={onSelect} formatBook={formatBook} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Book 43: 30' }));
    expect(onSelect).toHaveBeenLastCalledWith(43);
    rerender(<BookDistributionStrip bookCounts={{ 43: 30 }} selectedBook={43} onSelect={onSelect} formatBook={formatBook} />);
    expect(screen.getByRole('button', { name: 'Book 43: 30' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Book 43: 30' }));
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });
});
