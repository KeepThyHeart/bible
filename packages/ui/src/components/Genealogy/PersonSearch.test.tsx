import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonSearch } from './PersonSearch';
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
});
