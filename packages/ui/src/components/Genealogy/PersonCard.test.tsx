import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonCard } from './PersonCard';
import { graph } from './testFixtures';

const fmt = (id: number) => `V${id}`;

describe('PersonCard', () => {
  it('shows name, facts, relationships with verse links and confidence badges', async () => {
    const user = userEvent.setup();
    const onOpenVerse = vi.fn();
    const onFocusPerson = vi.fn();
    render(<PersonCard graph={graph} personId="abraham" formatVerse={fmt} onOpenVerse={onOpenVerse} onFocusPerson={onFocusPerson} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Abraham' })).toBeInTheDocument();
    expect(screen.getByText(/Male/)).toBeInTheDocument();
    expect(screen.getByText(/Tribe: Terah/)).toBeInTheDocument();
    const row = screen.getByText('Son').closest('li')!;
    expect(within(row).getByText('certain')).toHaveClass('kth-badge');
    await user.click(within(row).getByRole('button', { name: 'Open V1021003' }));
    expect(onOpenVerse).toHaveBeenCalledWith(1021003);
    await user.click(within(row).getByRole('button', { name: 'Isaac' }));
    expect(onFocusPerson).toHaveBeenCalledWith('isaac');
    await user.click(screen.getByRole('button', { name: 'Read' }));
    expect(onOpenVerse).toHaveBeenLastCalledWith(1011026);
    await user.click(screen.getByRole('button', { name: 'Show family tree' }));
    expect(onFocusPerson).toHaveBeenLastCalledWith('abraham');
  });

  it('falls back to the verse number when no formatter is given', () => {
    render(<PersonCard graph={graph} personId="abraham" />);
    expect(screen.getByRole('button', { name: 'Open 1021003' })).toHaveTextContent('1021003');
  });

  it('offers the alternative readings of a disputed link as radio choices', async () => {
    const user = userEvent.setup();
    const onSelectReading = vi.fn();
    render(<PersonCard graph={graph} personId="joseph_h" onSelectReading={onSelectReading} />);
    const group = screen.getByRole('radiogroup');
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
    expect(within(group).getByLabelText(/Heli → Joseph: Heli/)).toBe(radios[1]);
    await user.click(radios[1]);
    expect(onSelectReading).toHaveBeenCalledWith('g1', 'Heli');
  });

  it('checks the chosen reading', () => {
    render(<PersonCard graph={graph} personId="joseph_h" readings={{ g1: 'Heli' }} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[1]).toBeChecked();
  });

  it('lists other people with the same name', async () => {
    const user = userEvent.setup();
    const onFocusPerson = vi.fn();
    render(<PersonCard graph={graph} personId="jacob" formatVerse={fmt} onFocusPerson={onFocusPerson} />);
    const section = screen.getByRole('heading', { name: 'Other people named Jacob' }).closest('section')!;
    expect(within(section).getByText('V40001015')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Jacob' }));
    expect(onFocusPerson).toHaveBeenCalledWith('jacob_nt');
  });

  it('shows interpretive case notes with the KJV text', () => {
    render(<PersonCard graph={graph} personId="heli" />);
    expect(screen.getByRole('heading', { name: 'Who was the father of Joseph?' })).toBeInTheDocument();
    expect(screen.getByLabelText('KJV')).toHaveTextContent('Joseph, which was the son of Heli');
    expect(screen.getByText(/held by Luther/)).toBeInTheDocument();
  });

  it('close button, sheet class and label overrides', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<PersonCard graph={graph} personId="isaac" sheet onClose={onClose} labels={{ close: 'Cerrar', showTree: 'Ver árbol' }} />);
    expect(container.querySelector('aside')).toHaveClass('kth-genealogy-card--sheet');
    expect(screen.getByRole('button', { name: 'Ver árbol' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing for an unknown person', () => {
    const { container } = render(<PersonCard graph={graph} personId="nobody" />);
    expect(container).toBeEmptyDOMElement();
  });
});
