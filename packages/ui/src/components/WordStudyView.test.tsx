import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WordStudyView } from './WordStudyView';
import type { WordStudyViewProps } from './WordStudyView';
import { overviewFixture } from './wordStudyFixtures';
import { fillTemplate, DEFAULT_WORD_STUDY_LABELS } from './wordStudyLabels';

function props(over: Partial<WordStudyViewProps> = {}): WordStudyViewProps {
  return {
    overview: overviewFixture({
      family: [{ strongs: 'G26', gloss: 'love', relationship: 'child' }],
      semanticRange: { sourceLabel: 'src', senses: [{ label: 'love', source: 'x' }] },
    }),
    occurrences: { total: 3, items: [{ verseId: 1, start: 0, end: 0, form: 'love', text: 'love one' }] },
    filters: {},
    onFiltersChange: vi.fn(),
    onModuleChange: vi.fn(),
    onSelectStrongs: vi.fn(),
    onOpenOccurrence: vi.fn(),
    onLoadMore: vi.fn(),
    formatBook: (b) => `Book ${b}`,
    formatReference: (v) => `Ref ${v}`,
    query: '',
    onQueryChange: vi.fn(),
    onSubmitQuery: vi.fn(),
    groups: [],
    onOpenGroup: vi.fn(),
    onSaveGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onEditGroup: vi.fn(),
    ...over,
  };
}

describe('fillTemplate', () => {
  it('fills known names and keeps unknown', () => {
    expect(fillTemplate('{a} of {b} {c}', { a: 1, b: 'x' })).toBe('1 of x {c}');
    expect(DEFAULT_WORD_STUDY_LABELS.showing).toContain('{shown}');
  });
});

describe('WordStudyView', () => {
  it('renders all sections', () => {
    render(<WordStudyView {...props()} />);
    expect(screen.getByRole('heading', { name: 'agapao' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it is rendered' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where it occurs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Range of meaning' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Word family' })).toBeInTheDocument();
    expect(screen.getByText('Ref 1')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();
  });

  it('omits family when empty and uses "Forms found" for groups', () => {
    render(<WordStudyView {...props({ overview: overviewFixture({ subject: { kind: 'group', label: 'love' }, family: [] }) })} />);
    expect(screen.queryByRole('heading', { name: 'Word family' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Forms found' })).toBeInTheDocument();
  });

  it('merges filters from chart and strip, and clears them', async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<WordStudyView {...props({ onFiltersChange })} />);
    await user.click(screen.getByRole('button', { name: /loved/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ form: 'loved' });
    rerender(<WordStudyView {...props({ onFiltersChange, filters: { form: 'loved' } })} />);
    await user.click(screen.getByRole('button', { name: 'Book 43: 30' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ form: 'loved', book: 43 });
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({});
  });

  it('loads more only when items are missing', async () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<WordStudyView {...props({ onLoadMore })} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalled();
    rerender(<WordStudyView {...props({ occurrences: { total: 1, items: [{ verseId: 1, start: 0, end: 0, form: 'x' }] } })} />);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('submits the lookup query, picks candidates, selects family and opens occurrences', async () => {
    const p = props({ query: 'love', candidates: [{ strongs: 'G25', language: 'Greek', gloss: 'to love' }], onPickCandidate: vi.fn() });
    const user = userEvent.setup();
    render(<WordStudyView {...p} />);
    await user.type(screen.getByLabelText('Word to study'), 'x');
    expect(p.onQueryChange).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Study' }));
    expect(p.onSubmitQuery).toHaveBeenCalledWith('love');
    await user.click(screen.getByRole('button', { name: /G25/ }));
    expect(p.onPickCandidate).toHaveBeenCalledWith('G25');
    await user.click(screen.getByRole('button', { name: /G26/ }));
    expect(p.onSelectStrongs).toHaveBeenCalledWith('G26');
    await user.click(screen.getByRole('button', { name: /Ref 1/ }));
    expect(p.onOpenOccurrence).toHaveBeenCalled();
  });

  it('handles saved groups and the editor', async () => {
    const g = { id: 'g1', label: 'Love', terms: ['love'] };
    const p = props({ groups: [g], editingGroup: g });
    const user = userEvent.setup();
    render(<WordStudyView {...p} />);
    await user.click(screen.getByRole('button', { name: 'Love' }));
    expect(p.onOpenGroup).toHaveBeenCalledWith(g);
    await user.click(screen.getByRole('button', { name: 'Edit Love' }));
    expect(p.onEditGroup).toHaveBeenCalledWith(g);
    await user.click(screen.getByRole('button', { name: 'New group' }));
    expect(p.onEditGroup).toHaveBeenLastCalledWith({ id: '', label: '', terms: [] });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(p.onDeleteGroup).toHaveBeenCalledWith('g1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(p.onSaveGroup).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onEditGroup).toHaveBeenLastCalledWith(null);
  });

  it('hides the saved-groups UI when the host gives no group handlers (read-only web)', () => {
    const p = props({});
    const { onEditGroup: _e, onOpenGroup: _o, onSaveGroup: _s, onDeleteGroup: _d, groups: _g, ...rest } = p;
    render(<WordStudyView {...rest} />);
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('shows loading and error, with no overview', () => {
    render(<WordStudyView {...props({ overview: null, occurrences: null, loading: true, error: 'boom' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });
});
