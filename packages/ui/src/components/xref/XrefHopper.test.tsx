import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { XrefEdge } from '@bible/core/browser';
import { DEFAULT_XREF_HOPPER_LABELS, XrefHopper } from './XrefHopper';

const JOHN_3_16 = 43003016;
const GEN_1_1 = 1001001;
const ROM_5_8 = 45005008;
const PS_23_1 = 19023001;

const edge = (from: number, to: number, weight: number, extra: Partial<XrefEdge> = {}): XrefEdge => ({
  from, to, weight, sources: ['TSK'], direction: 'out', ...extra,
});

const fakeProvider = (map: Record<number, XrefEdge[]>) => ({
  getNeighbours: vi.fn(async (v: number, _limit?: number) => map[v] ?? []),
});

const formatRef = (v: number, end?: number) => `V${v}${end ? `-${end}` : ''}`;

const graph = {
  [JOHN_3_16]: [
    edge(JOHN_3_16, ROM_5_8, 0.9, { phrase: 'God so loved', direction: 'both', sources: ['TSK', 'user'] }),
    edge(JOHN_3_16, GEN_1_1, 0.3, { direction: 'in' }),
  ],
  [ROM_5_8]: [edge(ROM_5_8, PS_23_1, 0.5)],
  [PS_23_1]: [],
};

const cardFor = (ref: string) => screen.getByText(ref, { selector: '.kth-xref-hopper-ref' }).closest('li') as HTMLElement;

describe('XrefHopper', () => {
  it('renders ranked cards with strength, direction, phrase and sources', async () => {
    render(<XrefHopper provider={fakeProvider(graph)} anchor={JOHN_3_16} onOpenVerse={() => {}} formatRef={formatRef} />);
    await screen.findByText(`V${ROM_5_8}`, { selector: '.kth-xref-hopper-ref' });
    const items = Array.from(document.querySelectorAll<HTMLElement>('.kth-xref-hopper-card'));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(`V${ROM_5_8}`);
    expect(within(items[0]).getByRole('img', { name: 'strength 5 of 5' })).toBeInTheDocument();
    expect(items[0]).toHaveTextContent('cites and cited by');
    expect(items[0]).toHaveTextContent('God so loved');
    expect(items[0]).toHaveTextContent('TSK, user');
    expect(within(items[1]).getByRole('img', { name: 'strength 2 of 5' })).toBeInTheDocument();
    expect(items[1]).toHaveTextContent('cited by');
  });

  it('hops: pushes onto the trail, refetches and reports the anchor', async () => {
    const provider = fakeProvider(graph);
    const onAnchorChange = vi.fn();
    const user = userEvent.setup();
    render(<XrefHopper provider={provider} anchor={JOHN_3_16} onAnchorChange={onAnchorChange} onOpenVerse={() => {}} formatRef={formatRef} />);
    await screen.findByText(`V${ROM_5_8}`, { selector: '.kth-xref-hopper-ref' });
    await user.click(within(cardFor(`V${ROM_5_8}`)).getByRole('button', { name: `Hop to V${ROM_5_8}` }));
    expect(onAnchorChange).toHaveBeenCalledWith(ROM_5_8);
    await screen.findByText(`V${PS_23_1}`, { selector: '.kth-xref-hopper-ref' });
    expect(provider.getNeighbours).toHaveBeenCalledWith(ROM_5_8, 12);
    const trail = screen.getByRole('navigation', { name: 'Trail' });
    expect(within(trail).getByRole('button', { name: `V${JOHN_3_16}` })).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent(`V${ROM_5_8}`);
  });

  it('hops on Enter from the card body', async () => {
    const user = userEvent.setup();
    render(<XrefHopper provider={fakeProvider(graph)} anchor={JOHN_3_16} onOpenVerse={() => {}} formatRef={formatRef} />);
    await screen.findByText(`V${ROM_5_8}`, { selector: '.kth-xref-hopper-ref' });
    cardFor(`V${ROM_5_8}`).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent(`V${ROM_5_8}`));
  });

  it('trail jump truncates the trail; Back and Reset work', async () => {
    const user = userEvent.setup();
    const onAnchorChange = vi.fn();
    render(
      <XrefHopper provider={fakeProvider(graph)} anchor={PS_23_1} initialTrail={[JOHN_3_16, ROM_5_8]} onAnchorChange={onAnchorChange}
        onOpenVerse={() => {}} formatRef={formatRef} />,
    );
    const trail = screen.getByRole('navigation', { name: 'Trail' });
    expect(within(trail).getAllByRole('button', { name: /^V/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading')).toHaveTextContent(`V${ROM_5_8}`);
    expect(within(trail).getAllByRole('button', { name: /^V/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('heading')).toHaveTextContent(`V${JOHN_3_16}`);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(onAnchorChange).toHaveBeenLastCalledWith(JOHN_3_16);
  });

  it('jumping to an early trail entry cuts off the later ones', async () => {
    const user = userEvent.setup();
    render(
      <XrefHopper provider={fakeProvider(graph)} anchor={PS_23_1} initialTrail={[GEN_1_1, JOHN_3_16, ROM_5_8]}
        onOpenVerse={() => {}} formatRef={formatRef} />,
    );
    const trail = screen.getByRole('navigation', { name: 'Trail' });
    await user.click(within(trail).getByRole('button', { name: `V${JOHN_3_16}` }));
    expect(screen.getByRole('heading')).toHaveTextContent(`V${JOHN_3_16}`);
    expect(within(trail).getAllByRole('button', { name: /^V/ })).toHaveLength(1);
    expect(within(trail).queryByRole('button', { name: `V${ROM_5_8}` })).toBeNull();
  });

  it('ignores a stale response after a quick hop', async () => {
    let releaseFirst: (e: XrefEdge[]) => void = () => {};
    const provider = {
      getNeighbours: vi.fn((v: number) =>
        v === JOHN_3_16
          ? new Promise<XrefEdge[]>(r => { releaseFirst = r; })
          : Promise.resolve([edge(v, PS_23_1, 0.5)])),
    };
    const user = userEvent.setup();
    render(<XrefHopper provider={provider} anchor={JOHN_3_16} initialTrail={[GEN_1_1]} onOpenVerse={() => {}} formatRef={formatRef} />);
    await user.click(screen.getByRole('button', { name: `V${GEN_1_1}` }));
    await screen.findByText(`V${PS_23_1}`, { selector: '.kth-xref-hopper-ref' });
    releaseFirst([edge(JOHN_3_16, ROM_5_8, 0.9)]);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText(`V${ROM_5_8}`, { selector: '.kth-xref-hopper-ref' })).toBeNull();
    expect(screen.getByText(`V${PS_23_1}`, { selector: '.kth-xref-hopper-ref' })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    render(<XrefHopper provider={fakeProvider(graph)} anchor={PS_23_1} onOpenVerse={() => {}} formatRef={formatRef} />);
    expect(await screen.findByText(DEFAULT_XREF_HOPPER_LABELS.empty)).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    const getNeighbours = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([edge(JOHN_3_16, ROM_5_8, 0.9)]);
    const user = userEvent.setup();
    render(<XrefHopper provider={{ getNeighbours }} anchor={JOHN_3_16} onOpenVerse={() => {}} formatRef={formatRef} />);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(`V${ROM_5_8}`, { selector: '.kth-xref-hopper-ref' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens a passage with its range end and the current verse without one', async () => {
    const onOpenVerse = vi.fn();
    const user = userEvent.setup();
    const provider = fakeProvider({ [JOHN_3_16]: [edge(JOHN_3_16, ROM_5_8, 0.9, { toEnd: 45005010 })] });
    render(<XrefHopper provider={provider} anchor={JOHN_3_16} onOpenVerse={onOpenVerse} formatRef={formatRef} />);
    await user.click(await screen.findByRole('button', { name: `Open V${ROM_5_8}-45005010 in reader` }));
    expect(onOpenVerse).toHaveBeenCalledWith(ROM_5_8, 45005010);
    await user.click(screen.getByRole('button', { name: 'Open in reader' }));
    expect(onOpenVerse).toHaveBeenLastCalledWith(JOHN_3_16);
  });

  it('shows text only when getVerseText supplies it, cached per verse', async () => {
    const getVerseText = vi.fn(async (v: number) => (v === ROM_5_8 ? 'Passage text' : undefined));
    render(<XrefHopper provider={fakeProvider(graph)} anchor={JOHN_3_16} onOpenVerse={() => {}} formatRef={formatRef} getVerseText={getVerseText} />);
    expect(await screen.findByText('Passage text')).toBeInTheDocument();
    expect(document.querySelectorAll('.kth-xref-hopper-text')).toHaveLength(1);
    expect(getVerseText).toHaveBeenCalledWith(JOHN_3_16, undefined);
  });

  it('works without getVerseText', async () => {
    render(<XrefHopper provider={fakeProvider(graph)} anchor={JOHN_3_16} onOpenVerse={() => {}} formatRef={formatRef} />);
    await screen.findByText(`V${ROM_5_8}`, { selector: '.kth-xref-hopper-ref' });
    expect(document.querySelector('.kth-xref-hopper-text')).toBeNull();
  });

  it('pages with Show more and follows the anchor prop', async () => {
    const many = Array.from({ length: 5 }, (_, i) => edge(JOHN_3_16, 45005001 + i, 0.9 - i * 0.1));
    const provider = { getNeighbours: vi.fn(async (_v: number, limit?: number) => many.slice(0, limit)) };
    const user = userEvent.setup();
    const { rerender } = render(<XrefHopper provider={provider} anchor={JOHN_3_16} limit={2} onOpenVerse={() => {}} formatRef={formatRef} />);
    await screen.findByText('V45005002', { selector: '.kth-xref-hopper-ref' });
    expect(document.querySelectorAll('.kth-xref-hopper-card')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText('V45005004', { selector: '.kth-xref-hopper-ref' });
    expect(provider.getNeighbours).toHaveBeenLastCalledWith(JOHN_3_16, 4);
    rerender(<XrefHopper provider={provider} anchor={GEN_1_1} limit={2} onOpenVerse={() => {}} formatRef={formatRef} />);
    await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent(`V${GEN_1_1}`));
  });
});
