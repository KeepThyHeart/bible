import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EgoOptions, VerseId, XrefGraph } from '@bible/core/browser';
import { XrefConstellationView } from './XrefConstellationView';

const A = 43003016; // John 3:16
const B = 45005008; // Romans 5:8
const C = 1001001; // Genesis 1:1

function makeGraph(anchor: VerseId, others: VerseId[], truncated = false): XrefGraph {
  return {
    anchor,
    truncated,
    nodes: [{ verseId: anchor, hop: 0, degree: others.length }, ...others.map((v) => ({ verseId: v, hop: 1, degree: 2 }))],
    edges: others.map((v, i) => ({ from: anchor, to: v, weight: 0.9 - i * 0.2, sources: ['tsk'], direction: 'out' as const })),
  };
}

function setup(over: Partial<React.ComponentProps<typeof XrefConstellationView>> = {}, getEgoGraph?: (a: VerseId, o: EgoOptions) => Promise<XrefGraph>) {
  const fn = vi.fn(getEgoGraph ?? (async (a: VerseId) => makeGraph(a, a === A ? [B, C] : [A, C])));
  const props = {
    provider: { getEgoGraph: fn },
    anchor: A,
    onOpenVerse: vi.fn(),
    onAnchorChange: vi.fn(),
    getVerseText: vi.fn(async (id: VerseId) => `text of ${id}`),
    ...over,
  };
  const utils = render(<XrefConstellationView {...props} />);
  return { fn, props, user: userEvent.setup(), ...utils };
}

describe('XrefConstellationView', () => {
  it('draws the anchor and its cross-references as stars, with the layout hint', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'John 3:16' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rom 5:8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gen 1:1' })).toBeInTheDocument();
    expect(screen.getByText(/Genesis at the top, running clockwise/)).toBeInTheDocument();
    expect(screen.getByText('2 connected verses')).toBeInTheDocument();
  });

  it('puts each star in the direction of its book: Genesis above the centre, Romans lower than the top', async () => {
    const { container } = setup();
    await screen.findByRole('button', { name: 'John 3:16' });
    const pos = (name: string) => {
      const el = screen.getByRole('button', { name }) as unknown as SVGGElement;
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.getAttribute('style') ?? '');
      return { x: Number(m![1]), y: Number(m![2]) };
    };
    const centre = pos('John 3:16');
    const gen = pos('Gen 1:1');
    expect(Math.abs(gen.x - centre.x)).toBeLessThan(40);
    expect(gen.y).toBeLessThan(centre.y);
    expect(container.querySelectorAll('.kth-xref-star__book')).toHaveLength(66);
  });

  it('selects on click, shows the text and re-centres from the detail panel', async () => {
    const { user, props } = setup();
    await screen.findByRole('button', { name: 'John 3:16' });
    await user.click(screen.getByRole('button', { name: 'Rom 5:8' }));
    expect(await screen.findByText(`text of ${B}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Re-centre here' }));
    expect(props.onAnchorChange).toHaveBeenLastCalledWith(B);
    await waitFor(() => expect(props.provider.getEgoGraph).toHaveBeenLastCalledWith(B, expect.anything()));
  });

  it('Enter re-centres and Escape clears the selection', async () => {
    const { user, props } = setup();
    const star = await screen.findByRole('button', { name: 'Rom 5:8' });
    await user.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(star).toHaveAttribute('aria-pressed', 'false');
    act(() => { star.focus(); });
    await user.keyboard('{Enter}');
    expect(props.onAnchorChange).toHaveBeenLastCalledWith(B);
  });

  it('labels the hop buttons and the strength slider, and the slider becomes the weight floor', async () => {
    const { fn } = setup();
    await screen.findByRole('button', { name: 'John 3:16' });
    expect(screen.getByRole('button', { name: 'Hops: 2' })).toHaveAttribute('aria-pressed', 'true');
    const slider = screen.getByRole('slider', { name: /Minimum strength/ });
    act(() => { fireEvent.change(slider, { target: { value: '3' } }); });
    await waitFor(() => expect(fn).toHaveBeenLastCalledWith(A, expect.objectContaining({ minWeight: expect.closeTo(0.401, 3) })));
  });

  it('shows the empty and error states', async () => {
    const { unmount } = setup({}, async (a) => makeGraph(a, []));
    expect(await screen.findByText('No cross-references for this verse')).toBeInTheDocument();
    unmount();
    setup({}, async () => { throw new Error('x'); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the connections');
  });
});
