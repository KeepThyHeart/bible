import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RenderingChart } from './RenderingChart';
import { group } from './wordStudyFixtures';

const groups = [group('love', 50), group('loved', 30), group('charity', 20)];

describe('RenderingChart', () => {
  it('renders title, counts and shares', () => {
    render(<RenderingChart groups={groups} title="How it is rendered" onSelect={() => {}} />);
    expect(screen.getByRole('heading', { name: 'How it is rendered' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^love\s*50\s*\(50%\)/ })).toBeInTheDocument();
  });

  it('selects, and clears when the selected bar is clicked again', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<RenderingChart groups={groups} title="T" onSelect={onSelect} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /loved/ }));
    expect(onSelect).toHaveBeenLastCalledWith('loved');
    rerender(<RenderingChart groups={groups} title="T" selectedKey="loved" onSelect={onSelect} />);
    const btn = screen.getByRole('button', { name: /loved/ });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn);
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it('rolls extra rows into a non-clickable other row', () => {
    render(<RenderingChart groups={groups} title="T" maxRows={2} onSelect={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('Other (1)')).toBeInTheDocument();
    expect(screen.getByText('Other (1)').closest('button')).toBeNull();
  });

  it('shows the mode toggle only with onModeChange', async () => {
    const { rerender } = render(<RenderingChart groups={groups} title="T" onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Full phrase' })).toBeNull();
    const onModeChange = vi.fn();
    rerender(<RenderingChart groups={groups} title="T" onSelect={() => {}} onModeChange={onModeChange} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Full phrase' }));
    expect(onModeChange).toHaveBeenCalledWith('phrase');
  });
});
