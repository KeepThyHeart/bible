import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox, Radio } from './Checkbox';

describe('Checkbox', () => {
  it('toggles through its label and reports the new state', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Mon" hint="(first)" />);
    await userEvent.click(screen.getByText('Mon'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('checkbox', { name: /Mon/ })).toBeInTheDocument();
    expect(screen.getByText('(first)')).toHaveClass('kth-check__hint');
  });

  it('reports false when unchecking', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} label="Mon" />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('uses ariaLabel without a visible label', () => {
    const { container } = render(<Checkbox checked onChange={() => {}} ariaLabel="Done" />);
    expect(screen.getByRole('checkbox', { name: 'Done' })).toBeChecked();
    expect(container.querySelector('label')).toBeNull();
    expect(container.querySelector('span.kth-check')).not.toBeNull();
  });

  it('success tone and disabled add classes and block changes', async () => {
    const onChange = vi.fn();
    const { container } = render(<Checkbox checked onChange={onChange} label="x" tone="success" disabled />);
    expect(container.querySelector('label')).toHaveClass('kth-check', 'kth-check--success', 'kth-check--disabled');
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Radio', () => {
  it('selects on click and carries name and value', async () => {
    const onChange = vi.fn();
    render(<Radio checked={false} onChange={onChange} name="mode" value="a" label="Option A" hint="hint" />);
    const r = screen.getByRole('radio', { name: /Option A/ });
    expect(r).toHaveAttribute('name', 'mode');
    expect(r).toHaveAttribute('value', 'a');
    await userEvent.click(screen.getByText('Option A'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
