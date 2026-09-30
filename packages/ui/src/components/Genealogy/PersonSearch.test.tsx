import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonSearch } from './PersonSearch';
import { GenealogyGraph } from '@bible/core/browser';
import { graph } from './testFixtures';

describe('PersonSearch', () => {
  it('lists matches for what is typed and picks one by click', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<PersonSearch graph={graph} onPick={onPick} />);
    const input = screen.getByRole('combobox', { name: 'Find a person' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.type(input, 'ja');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Jacob', 'Jacob']);
    expect(screen.getByRole('status')).toHaveTextContent('2 matches');
    await user.click(screen.getAllByRole('option')[1]);
    expect(onPick).toHaveBeenCalledWith('jacob_nt');
    expect(input).toHaveValue('');
  });

  it('picks with the keyboard', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<PersonSearch graph={graph} onPick={onPick} />);
    await user.type(screen.getByRole('combobox'), 'is');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('isaac');
  });

  it('moves the active option with arrows and shows no-results text', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<PersonSearch graph={graph} onPick={onPick} />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'ja');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledWith('jacob_nt');
    await user.type(input, 'zzz');
    expect(screen.getByText('No matching people')).toBeInTheDocument();
  });

  it('tells namesakes apart with a short descriptor, tribe and verse', async () => {
    const user = userEvent.setup();
    const namesakes = GenealogyGraph.from({
      module: 'test', sources: [], lineages: [], edges: [],
      persons: [
        { id: 'judah', name: 'Judah', kind: 'individual', tribe: 'judah', firstRef: 1029035, notes: "Jacob's son living at the time of the Patriarchs. Son of Israel" },
        { id: 'judah_neh_11_9', name: 'Judah', kind: 'individual', tribe: 'benjamin', firstRef: 16011009, notes: 'Man living at the time of Exile and Return. Returned leader' },
        { id: 'judah_neh_12_36', name: 'Judah', kind: 'individual', firstRef: 16012036, notes: 'Man living at the time of Exile and Return. Returned priest' },
      ],
    });
    render(<PersonSearch graph={namesakes} onPick={vi.fn()} formatVerse={(v) => `v${v}`} />);
    await user.type(screen.getByRole('combobox'), 'judah');
    const rows = screen.getAllByRole('option').map((o) => o.textContent);
    expect(rows).toHaveLength(3);
    expect(new Set(rows).size).toBe(3);
    expect(rows).toContain('Judah Son of Israel · Tribe of Judah · v1029035');
    expect(rows).toContain('Judah Returned priest · v16012036');
  });
});
