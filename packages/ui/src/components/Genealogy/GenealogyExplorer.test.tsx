import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createGenealogyStore } from '@bible/core/browser';
import type { GenealogyGraph, GenealogyState } from '@bible/core/browser';
import { GenealogyExplorer } from './GenealogyExplorer';
import { graph, layout } from './testFixtures';

function setup(props: { compact?: boolean; init?: Partial<GenealogyState> } = {}) {
  const store = createGenealogyStore(props.init);
  const computeLayout = vi.fn((_g: GenealogyGraph, _s: GenealogyState) => layout);
  const onOpenVerse = vi.fn();
  const utils = render(<GenealogyExplorer graph={graph} store={store} computeLayout={computeLayout} compact={props.compact} onOpenVerse={onOpenVerse} formatVerse={(v) => `V${v}`} />);
  return { store, computeLayout, onOpenVerse, user: userEvent.setup(), ...utils };
}

describe('GenealogyExplorer', () => {
  it('renders the tabs, toggles, search and view', () => {
    setup();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Line to Christ', 'Family', 'Tribes']);
    expect(screen.getByRole('tab', { name: 'Line to Christ' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Fade people not on Christ\'s line')).toBeChecked();
    expect(screen.getByLabelText('Show disputed links')).not.toBeChecked();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getAllByRole('graphics-symbol')).toHaveLength(5);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('full screen toggles a class and Escape leaves it', async () => {
    const { container, user } = setup();
    const root = container.firstElementChild!;
    await user.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(root).toHaveClass('kth-fs-on');
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(root).not.toHaveClass('kth-fs-on'));
  });

  it('shows a one-line hint per view and a Key that opens on demand', async () => {
    const { user } = setup();
    expect(screen.getByText(/One line of fathers from Adam to Jesus/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Key' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Key' }));
    expect(await screen.findByRole('region', { name: 'Key' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Family' }));
    expect(await screen.findByText(/parents, wives and children/)).toBeInTheDocument();
  });

  it('does not dim the selected person', async () => {
    const { user } = setup();
    await user.click(document.querySelector('[data-node-id="isaac"]')!);
    await waitFor(() => expect(document.querySelector('[data-node-id="isaac"]')).toHaveClass('kth-genealogy-node--selected'));
    expect(document.querySelector('[data-node-id="isaac"]')).not.toHaveClass('kth-genealogy-node--dim');
  });

  it('switches view through the store and recomputes the layout', async () => {
    const { store, computeLayout, user } = setup();
    computeLayout.mockClear();
    await user.click(screen.getByRole('tab', { name: 'Tribes' }));
    expect(store.getSnapshot().view).toBe('tribes');
    expect(computeLayout).toHaveBeenCalled();
    expect(computeLayout.mock.calls.at(-1)![1].view).toBe('tribes');
    expect(screen.getByRole('region', { name: 'Legend' })).toBeInTheDocument();
  });

  it('toggles reach the store; showing disputed links rebuilds the graph passed to the layout', async () => {
    const { store, computeLayout, user } = setup();
    await user.click(screen.getByLabelText('Show disputed links'));
    expect(store.getSnapshot().showDisputed).toBe(true);
    expect(computeLayout.mock.calls.at(-1)![0].options.showDisputed).toBe(true);
    await user.click(screen.getByLabelText('Fade people not on Christ\'s line'));
    expect(store.getSnapshot().highlightLineToChrist).toBe(false);
  });

  it('selecting a node opens the card; selection does not recompute the layout', async () => {
    const { store, computeLayout, user } = setup();
    computeLayout.mockClear();
    await user.click(document.querySelector('[data-node-id="isaac"]')!);
    expect(store.getSnapshot().selectedId).toBe('isaac');
    expect(screen.getByRole('heading', { level: 2, name: 'Isaac' })).toBeInTheDocument();
    expect(computeLayout).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(store.getSnapshot().selectedId).toBeNull();
  });

  it('reacts to external store updates and Show family tree focuses the person', async () => {
    const { store, user } = setup();
    act(() => store.setState((s) => ({ ...s, selectedId: 'abraham' })));
    expect(screen.getByRole('heading', { level: 2, name: 'Abraham' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show family tree' }));
    expect(store.getSnapshot()).toMatchObject({ view: 'family', focusId: 'abraham', selectedId: 'abraham' });
  });

  it('choosing another reading updates the store', async () => {
    const { store, user } = setup({ init: { selectedId: 'joseph_h', showDisputed: true } });
    await user.click(within(screen.getByRole('radiogroup')).getAllByRole('radio')[1]);
    expect(store.getSnapshot().readings).toEqual({ g1: 'Heli' });
  });

  it('searching picks a person that is in the layout', async () => {
    const { store, user } = setup();
    await user.type(screen.getByRole('combobox'), 'hel');
    await user.click(screen.getByRole('option', { name: /Heli/ }));
    expect(store.getSnapshot().selectedId).toBe('heli');
    expect(store.getSnapshot().view).toBe('line');
  });

  it('the Read button forwards the first verse', async () => {
    const { onOpenVerse, user } = setup({ init: { selectedId: 'abraham' } });
    await user.click(screen.getByRole('button', { name: 'Read' }));
    expect(onOpenVerse).toHaveBeenCalledWith(1011026);
  });

  it('renders the card as a bottom sheet when compact', () => {
    const { container } = setup({ compact: true, init: { selectedId: 'abraham' } });
    expect(container.querySelector('.kth-genealogy-explorer')).toHaveClass('kth-genealogy-explorer--compact');
    expect(container.querySelector('aside')).toHaveClass('kth-genealogy-card--sheet');
  });
});
