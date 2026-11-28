import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProgressTile, ProgressTiles } from './ProgressTile';

describe('ProgressTile', () => {
  it('shows a named ring, a title button and a muted status inside a labelled list', async () => {
    const onTitleClick = vi.fn();
    render(
      <ProgressTiles aria-label="Progress" testId="tiles">
        <ProgressTile value={42} ringLabel="Gospels: progress" title="Gospels" onTitleClick={onTitleClick} status="On track" testId="tile" />
      </ProgressTiles>,
    );
    const list = screen.getByRole('list', { name: 'Progress' });
    expect(list).toHaveClass('kth-progress-tiles');
    const tile = screen.getByTestId('tile');
    expect(tile).toHaveClass('kth-card', 'kth-progress-tile');
    expect(screen.getByRole('progressbar', { name: 'Gospels: progress' })).toHaveTextContent('42%');
    expect(tile.querySelector('.kth-progress-tile__status')).toHaveAttribute('data-tone', 'muted');
    expect(tile).not.toHaveTextContent('⚠');
    await userEvent.click(screen.getByRole('button', { name: 'Gospels' }));
    expect(onTitleClick).toHaveBeenCalledTimes(1);
  });

  it('marks a warning, renders a plain title without a handler, and shows actions', () => {
    const { container } = render(
      <ProgressTiles aria-label="Progress">
        <ProgressTile value={10} ringLabel="x" title="Psalms" status="3 days behind" statusTone="warning"
          actions={<button type="button">Reschedule</button>} />
      </ProgressTiles>,
    );
    expect(screen.queryByRole('button', { name: 'Psalms' })).toBeNull();
    expect(container.querySelector('span.kth-progress-tile__title')).toHaveTextContent('Psalms');
    const status = container.querySelector('.kth-progress-tile__status');
    expect(status).toHaveAttribute('data-tone', 'warning');
    expect(status).toHaveTextContent('⚠ 3 days behind');
    expect(container.querySelector('.kth-progress-tile__actions')).toContainElement(screen.getByRole('button', { name: 'Reschedule' }));
  });

  it('omits the status and actions when not given', () => {
    const { container } = render(<ul><ProgressTile value={0} ringLabel="x" title="Empty" /></ul>);
    expect(container.querySelector('.kth-progress-tile__status')).toBeNull();
    expect(container.querySelector('.kth-progress-tile__actions')).toBeNull();
  });
});
