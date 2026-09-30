import { render, screen, within } from '@testing-library/react';
import { LineageCompare } from './LineageCompare';
import { TribeLegend } from './TribeLegend';
import { graph } from './testFixtures';

describe('TribeLegend', () => {
  it('shows the four mothers and the gold line', () => {
    const { container } = render(<TribeLegend />);
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual(
      ['Sons of Leah', 'Sons of Rachel', 'Sons of Bilhah', 'Sons of Zilpah', 'Line to Christ']);
    expect(container.querySelector('.kth-genealogy-color-bilhah')).not.toBeNull();
    expect(container.querySelector('.kth-genealogy-swatch--christ')).not.toBeNull();
  });
  it('can hide the Christ entry', () => {
    render(<TribeLegend showChrist={false} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});

describe('LineageCompare', () => {
  it('lists both lineages, one-text-only markers and gaps', () => {
    render(<LineageCompare graph={graph} lineages={graph.lineages()} formatVerse={(v) => `v${v}`} />);
    const matthew = screen.getByRole('region', { name: 'Matthew 1' });
    const luke = screen.getByRole('region', { name: 'Luke 3' });
    expect(within(matthew).getAllByRole('listitem')).toHaveLength(4);
    expect(within(matthew).getByText('2 not named here: Ahaziah, Joash')).toBeInTheDocument();
    expect(within(matthew).getAllByText('in this text only')).toHaveLength(2); // Isaac, Jacob
    expect(within(luke).getAllByText('in this text only')).toHaveLength(1); // Heli
    expect(within(luke).getByRole('button', { name: 'Open v42003034' })).toBeInTheDocument();
  });
});
