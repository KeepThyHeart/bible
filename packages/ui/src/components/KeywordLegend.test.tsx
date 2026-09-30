import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordLegend } from './KeywordLegend';
import type { KeywordLegendProps, LegendRow } from './KeywordLegend';

const rows: LegendRow[] = [
  { id: 'a', label: 'love', color: 'mark.1', line: 'solid', symbol: '●', count: 4, hidden: false },
  { id: 'b', label: 'therefore', color: 'mark.2', line: 'dashed', symbol: '▲', count: 2, hidden: true, approximate: true, setName: 'Connectives' },
  { id: 'c', label: 'grace', color: 'mark.3', line: 'none', count: 0, hidden: false },
];

function setup(props: Partial<KeywordLegendProps> = {}) {
  const fns = { onToggleEnabled: vi.fn(), onToggleRow: vi.fn(), onStep: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(), onManageSets: vi.fn(), onAcceptSuggestion: vi.fn() };
  render(<KeywordLegend enabled rows={rows} {...fns} {...props} />);
  return { ...fns, user: userEvent.setup() };
}

describe('KeywordLegend', () => {
  it('renders a real list with a row per mark, its count and symbol', () => {
    setup();
    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('love');
    expect(items[0]).toHaveTextContent('●');
    expect(within(items[0]).getByLabelText('4 occurrences')).toBeInTheDocument();
    expect(within(items[2]).getByLabelText('0 occurrences')).toBeInTheDocument();
  });

  it('always shows divine names capitalized, in rows, controls and suggestions', () => {
    setup({
      rows: [{ id: 'g', label: 'god', color: 'mark.1', line: 'solid', symbol: '○', count: 3, hidden: false }],
      suggestions: [{ key: '0', label: 'jesus', count: 5 }],
    });
    expect(screen.getByRole('button', { name: 'Hide God' })).toHaveTextContent('God');
    expect(screen.getByRole('button', { name: 'Next God' })).toBeInTheDocument();
    expect(screen.getByText('Jesus')).toBeInTheDocument();
  });

  it('master toggle is a pressed button', async () => {
    const { user, onToggleEnabled } = setup();
    const toggle = screen.getByRole('button', { name: 'Keyword marks', pressed: true });
    await user.click(toggle);
    expect(onToggleEnabled).toHaveBeenCalledTimes(1);
  });

  it('disables row controls when marks are off', () => {
    setup({ enabled: false });
    expect(screen.getByRole('button', { name: 'Keyword marks', pressed: false })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next love' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hide love' })).toBeDisabled();
  });

  it('row buttons toggle, step, and edit', async () => {
    const { user, onToggleRow, onStep, onEdit } = setup();
    await user.click(screen.getByRole('button', { name: 'Hide love' }));
    expect(onToggleRow).toHaveBeenCalledWith('a');
    await user.click(screen.getByRole('button', { name: 'Next love' }));
    expect(onStep).toHaveBeenLastCalledWith('a', 'next');
    await user.click(screen.getByRole('button', { name: 'Previous love' }));
    expect(onStep).toHaveBeenLastCalledWith('a', 'prev');
    await user.click(screen.getByRole('button', { name: 'Edit love' }));
    expect(onEdit).toHaveBeenCalledWith('a');
  });

  it('hidden rows are not pressed and cannot be stepped; empty rows cannot be stepped', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Show therefore', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next therefore' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next grace' })).toBeDisabled();
  });

  it('marks approximate rows and shows the set name', () => {
    setup();
    const item = screen.getAllByRole('listitem')[1];
    expect(within(item).getByText('approx.')).toBeInTheDocument();
    expect(item).toHaveTextContent('(Connectives)');
  });

  it('announces the parent-supplied stepping result in a polite live region', () => {
    setup({ announcement: 'love: verse 5, 2 of 4' });
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('love: verse 5, 2 of 4');
  });

  it('lists suggestions with an Add button each', async () => {
    const { user, onAcceptSuggestion } = setup({ suggestions: [{ key: 's1', label: 'faith', count: 6 }] });
    await user.click(screen.getByRole('button', { name: 'Add faith' }));
    expect(onAcceptSuggestion).toHaveBeenCalledWith('s1');
  });

  it('shows the interlinear note, footer actions and an empty state', async () => {
    const { user, onAdd, onManageSets } = setup({ rows: [], interlinearNote: "Strong's marks need an interlinear translation." });
    expect(screen.getByText('No keywords match in this chapter.')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent("Strong's marks need");
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    await user.click(screen.getByRole('button', { name: 'Manage sets' }));
    expect(onAdd).toHaveBeenCalled();
    expect(onManageSets).toHaveBeenCalled();
  });

  it('takes labels from props', () => {
    setup({ labels: { title: 'Mots-cles', count: (n) => `${n} fois` } });
    expect(screen.getByRole('region', { name: 'Mots-cles' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('4 fois')).toHaveLength(1);
  });
});
