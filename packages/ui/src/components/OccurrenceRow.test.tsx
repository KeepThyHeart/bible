import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OccurrenceRow, highlightWords } from './OccurrenceRow';
import type { WordOccurrenceItem } from '@bible/core/browser';

const item: WordOccurrenceItem = { verseId: 43003016, start: 1, end: 2, form: 'loved', morph: 'V-AAI', text: 'For God so loved the world' };

describe('OccurrenceRow', () => {
  it('shows reference, form, morph and marks the matched words', () => {
    const { container } = render(<OccurrenceRow item={{ ...item, start: 3, end: 4 }} reference="John 3:16" onOpen={() => {}} />);
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('loved', { selector: '.kth-ws-chip' })).toBeInTheDocument();
    expect(screen.getByText('V-AAI')).toBeInTheDocument();
    const marks = container.querySelectorAll('mark.kth-ws-hit');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('loved the');
    expect(container.querySelector('.kth-ws-occ__text')?.textContent).toBe('For God so loved the world');
  });

  it('highlightWords handles ranges at the edges and out of range', () => {
    const text = (n: unknown[]) => n.map((x) => (typeof x === 'string' ? x : (x as { props: { children: string } }).props.children)).join('');
    expect(text(highlightWords('a b c', 0, 0))).toBe('a b c');
    expect(highlightWords('a b c', 0, 0)).toHaveLength(2);
    expect(highlightWords('a b c', 5, 6)).toEqual(['a b c']);
  });

  it('opens on click and prefers renderVerse', async () => {
    const onOpen = vi.fn();
    render(<OccurrenceRow item={item} reference="R" onOpen={onOpen} renderVerse={() => <em>custom</em>} />);
    expect(screen.getByText('custom')).toBeInTheDocument();
    expect(screen.queryByText(/For God/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(item);
  });
});
