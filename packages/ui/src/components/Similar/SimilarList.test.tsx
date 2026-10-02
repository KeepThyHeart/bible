import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SimilarList, DEFAULT_SIMILAR_LIST_LABELS, similarityStep } from './SimilarList';
import type { SimilarListProps, SimilarListRow } from './SimilarList';

const row = (o: Partial<SimilarListRow> & { key: string }): SimilarListRow => ({
  startVerseId: 1,
  endVerseId: 1,
  level: 'verse',
  similarity: 0.8,
  isCrossReference: false,
  crossesTestament: false,
  via: 'table',
  reference: `Ref ${o.key}`,
  text: `Text ${o.key}`,
  ...o,
});

function setup(rows: SimilarListRow[], props: Partial<SimilarListProps> = {}) {
  const fns = { onOpen: vi.fn(), onMoreLike: vi.fn() };
  render(<SimilarList rows={rows} {...fns} {...props} />);
  return { ...fns, user: userEvent.setup() };
}

describe('similarityStep', () => {
  it('normalises over [floor, top1] into 1..5', () => {
    expect(similarityStep(1, 0.5, 1)).toBe(5);
    expect(similarityStep(0.5, 0.5, 1)).toBe(1);
    expect(similarityStep(0.6, 0.5, 1)).toBe(1);
    expect(similarityStep(0.75, 0.5, 1)).toBe(3);
    expect(similarityStep(0.9, 0.5, 1)).toBe(4);
  });
  it('clamps and handles a degenerate scale', () => {
    expect(similarityStep(0.2, 0.5, 1)).toBe(1);
    expect(similarityStep(2, 0.5, 1)).toBe(5);
    expect(similarityStep(0.7, 0.7, 0.7)).toBe(5);
  });
});

describe('SimilarList', () => {
  it('renders a list with reference, text and a bar per row', () => {
    setup([row({ key: 'a', similarity: 1 }), row({ key: 'b', similarity: 0.5 })], { floor: 0.5 });
    const items = within(screen.getAllByRole('list')[0]).getAllByRole('listitem', {});
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Ref a')).toBeInTheDocument();
    expect(screen.getByText('Text b')).toBeInTheDocument();
    expect(screen.getByLabelText('Similarity 5 of 5')).toBeInTheDocument();
    expect(screen.getByLabelText('Similarity 1 of 5')).toBeInTheDocument();
  });

  it('isolates the reference text so a leading book number keeps its place in an RTL UI', () => {
    setup([row({ key: 'a', reference: '1 John 4:10' })]);
    expect(screen.getByText('1 John 4:10').tagName).toBe('BDI');
  });

  it('shows cross-reference and testament badges only when flagged', () => {
    setup([row({ key: 'a', isCrossReference: true, crossesTestament: true }), row({ key: 'b' })]);
    expect(screen.getAllByText(DEFAULT_SIMILAR_LIST_LABELS.crossRef)).toHaveLength(1);
    expect(screen.getAllByText(DEFAULT_SIMILAR_LIST_LABELS.otNtBadge)).toHaveLength(1);
  });

  it('renders reason chips, the fallback for an empty array, and nothing for undefined', () => {
    const rows = [row({ key: 'a' }), row({ key: 'b' }), row({ key: 'c' })];
    setup(rows, {
      reasonsFor: (r) =>
        r.key === 'a'
          ? [
              { kind: 'lemma', strongs: 'G26', lemma: 'agape', gloss: 'love' },
              { kind: 'topic', label: 'Love', source: 'naves' },
              { kind: 'words', words: ['grace', 'mercy'] },
            ]
          : r.key === 'b'
            ? []
            : undefined,
    });
    expect(screen.getByText('G26 agape "love"')).toBeInTheDocument();
    expect(screen.queryByText('Love')).toBeNull(); // topic tags are not shown
    expect(screen.getByText('grace, mercy')).toBeInTheDocument();
    expect(screen.getAllByText(DEFAULT_SIMILAR_LIST_LABELS.similarInMeaning)).toHaveLength(1);
  });

  it('opens in the same tab on click and a new tab on ctrl-click', async () => {
    const { user, onOpen } = setup([row({ key: 'a' })]);
    await user.click(screen.getByText('Ref a'));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'a' }), { newTab: false });
    await user.keyboard('{Control>}');
    await user.click(screen.getByText('Ref a'));
    await user.keyboard('{/Control}');
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'a' }), { newTab: true });
  });

  it('calls onMoreLike and onMenu with the anchor', async () => {
    const onMenu = vi.fn();
    const { user, onMoreLike } = setup([row({ key: 'a' })], { onMenu });
    await user.click(screen.getByRole('button', { name: /More like this: Ref a/ }));
    expect(onMoreLike).toHaveBeenCalledWith(expect.objectContaining({ key: 'a' }));
    await user.click(screen.getByRole('button', { name: /More actions: Ref a/ }));
    expect(onMenu).toHaveBeenCalledWith(expect.objectContaining({ key: 'a' }), expect.any(HTMLElement));
  });

  it('omits the menu button without onMenu and overrides labels', () => {
    setup([row({ key: 'a', isCrossReference: true })], { labels: { moreLikeThis: 'Mas', crossRef: 'Ref. cruzada' } });
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(screen.getByText('Mas')).toBeInTheDocument();
    expect(screen.getByText('Ref. cruzada')).toBeInTheDocument();
  });

  it('shows the empty label', () => {
    setup([], { labels: { empty: 'Nada' } });
    expect(screen.getByText('Nada')).toBeInTheDocument();
  });

  it('fires onVisible once per row (immediately without IntersectionObserver)', () => {
    const onVisible = vi.fn();
    const rows = [row({ key: 'a' }), row({ key: 'b' })];
    const { rerender } = render(<SimilarList rows={rows} onOpen={vi.fn()} onMoreLike={vi.fn()} onVisible={onVisible} />);
    expect(onVisible).toHaveBeenCalledTimes(2);
    rerender(<SimilarList rows={[...rows]} onOpen={vi.fn()} onMoreLike={vi.fn()} onVisible={onVisible} />);
    expect(onVisible).toHaveBeenCalledTimes(2);
  });
});
