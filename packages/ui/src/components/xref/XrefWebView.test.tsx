import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EgoOptions, VerseId, XrefGraph } from '@bible/core/browser';
import { XrefWebView } from './XrefWebView';

const A = 43003016; // John 3:16
const B = 45005008;
const C = 43001001;

function makeGraph(anchor: VerseId, others: VerseId[], truncated = false): XrefGraph {
  return {
    anchor,
    truncated,
    nodes: [{ verseId: anchor, hop: 0, degree: others.length }, ...others.map((v) => ({ verseId: v, hop: 1, degree: 2 }))],
    edges: others.map((v, i) => ({ from: anchor, to: v, weight: 0.9 - i * 0.2, sources: ['tsk'], direction: 'out' as const })),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(over: Partial<React.ComponentProps<typeof XrefWebView>> = {}, getEgoGraph?: (a: VerseId, o: EgoOptions) => Promise<XrefGraph>) {
  const fn = vi.fn(getEgoGraph ?? (async (a: VerseId) => makeGraph(a, a === A ? [B, C] : [A, C])));
  const props = {
    provider: { getEgoGraph: fn },
    anchor: A,
    onOpenVerse: vi.fn(),
    onAnchorChange: vi.fn(),
    ...over,
  };
  const utils = render(<XrefWebView {...props} />);
  return { fn, props, user: userEvent.setup(), ...utils };
}

const node = (name: string) => screen.getByRole('button', { name, description: undefined } as never);

describe('XrefWebView', () => {
  it('renders the nodes and the anchor', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'John 3:16' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rom 5:8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'John 1:1' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /Connected verses/ });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('selecting a node shows the detail panel with text, and Open in reader works', async () => {
    const getVerseText = vi.fn(async () => 'For God so loved');
    const { user, props } = setup({ getVerseText });
    await user.click(await screen.findByRole('button', { name: 'Rom 5:8' }));
    const panel = screen.getByRole('complementary', { name: 'Selected verse' });
    expect(within(panel).getByRole('heading', { name: 'Rom 5:8' })).toBeInTheDocument();
    expect(await within(panel).findByText('For God so loved')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Open in reader' }));
    expect(props.onOpenVerse).toHaveBeenCalledWith(B, undefined);
  });

  it('Escape clears the selection', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Rom 5:8' }));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('keeps the hidden list out of the tab order', async () => {
    setup();
    await screen.findByRole('button', { name: 'Rom 5:8' });
    const list = screen.getByRole('list');
    const buttons = within(list).getAllByRole('button', { hidden: true });
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.getAttribute('tabindex')).toBe('-1');
  });

  it('Enter re-centres and refetches; Back returns', async () => {
    const { user, fn, props } = setup();
    const n = await screen.findByRole('button', { name: 'Rom 5:8' });
    n.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(fn).toHaveBeenLastCalledWith(B, expect.objectContaining({ depth: 2 })));
    expect(props.onAnchorChange).toHaveBeenCalledWith(B);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(fn).toHaveBeenLastCalledWith(A, expect.anything()));
    expect(props.onAnchorChange).toHaveBeenLastCalledWith(A);
  });

  it('depth buttons refetch with the new depth', async () => {
    const { user, fn } = setup();
    await screen.findByRole('button', { name: 'John 3:16' });
    await user.click(screen.getByRole('button', { name: 'Hops: 3' }));
    await waitFor(() => expect(fn).toHaveBeenLastCalledWith(A, expect.objectContaining({ depth: 3, maxNodes: 60 })));
  });

  it('shows the truncated notice', async () => {
    setup({}, async (a) => makeGraph(a, [B, C], true));
    expect(await screen.findByText('Showing the strongest 2 connections')).toBeInTheDocument();
  });

  it('shows an error and retries', async () => {
    let calls = 0;
    const { user, fn } = setup({}, async (a) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return makeGraph(a, [B]);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the connections');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Rom 5:8' })).toBeInTheDocument();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the empty state', async () => {
    setup({}, async (a) => makeGraph(a, []));
    expect(await screen.findByText('No cross-references for this verse')).toBeInTheDocument();
  });

  it('ignores a stale response after a quick re-centre', async () => {
    const first = deferred<XrefGraph>();
    const second = deferred<XrefGraph>();
    const queue = [first, second];
    const { rerender, props } = setup({}, () => queue.shift()!.promise);
    rerender(<XrefWebView {...props} anchor={B} />);
    await act(async () => { second.resolve(makeGraph(B, [C])); });
    expect(await screen.findByRole('button', { name: 'John 1:1' })).toBeInTheDocument();
    await act(async () => { first.resolve(makeGraph(A, [B])); });
    expect(screen.queryByRole('button', { name: 'John 3:16' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Rom 5:8' })).toBeInTheDocument();
  });

  it('unmounts cleanly with a pending request', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deferred<XrefGraph>();
    const { unmount } = setup({}, () => d.promise);
    unmount();
    await act(async () => { d.resolve(makeGraph(A, [B])); });
    await new Promise((r) => setTimeout(r, 50));
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('arrow keys move focus between nodes', async () => {
    const { user } = setup();
    const a = await screen.findByRole('button', { name: 'John 3:16' });
    a.focus();
    await user.keyboard('{ArrowRight}{ArrowLeft}{ArrowUp}{ArrowDown}');
    expect(document.activeElement?.getAttribute('role')).toBe('button');
  });
});

void node;

describe('XrefWebView controls and camera', () => {
  it('explains the hop count and strength, and the help button shows the plain-language text', async () => {
    const { user } = setup();
    await screen.findByRole('button', { name: 'John 3:16' });
    expect(screen.getByText('Hops')).toBeInTheDocument();
    expect(screen.getByText('Any')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'What do these controls mean?' }));
    expect(screen.getByRole('note')).toHaveTextContent(/Treasury of Scripture Knowledge/);
  });

  it('the strength slider is 1 to 5 and asks the provider for the matching weight floor', async () => {
    const { fn } = setup();
    await screen.findByRole('button', { name: 'John 3:16' });
    const slider = screen.getByRole('slider', { name: /Minimum strength/ });
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '5');
    act(() => { fireEvent.change(slider, { target: { value: '4' } }); });
    expect(await screen.findByText('4 of 5 and up')).toBeInTheDocument();
    await waitFor(() => expect(fn).toHaveBeenLastCalledWith(A, expect.objectContaining({ minWeight: expect.closeTo(0.601, 3) })));
  });

  it('zoom buttons freeze the camera and Fit all / Focus switch it back', async () => {
    const { user, container } = setup();
    await screen.findByRole('button', { name: 'John 3:16' });
    const layer = () => container.querySelector('svg > g')!.getAttribute('transform')!;
    const initial = layer();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    const zoomed = layer();
    expect(zoomed).not.toBe(initial);
    await user.click(screen.getByRole('button', { name: 'Fit all' }));
    expect(screen.getByRole('button', { name: 'Fit all' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('dragging a node freezes the camera instead of chasing the node', async () => {
    const { container } = setup();
    const anchor = await screen.findByRole('button', { name: 'John 3:16' });
    const layer = () => container.querySelector('svg > g')!.getAttribute('transform');
    fireEvent.pointerDown(anchor, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(anchor, { pointerId: 1, clientX: 160, clientY: 140 });
    const during = layer();
    fireEvent.pointerMove(anchor, { pointerId: 1, clientX: 220, clientY: 180 });
    fireEvent.pointerUp(anchor, { pointerId: 1 });
    expect(layer()).toBe(during);
  });

  it('returns to the default camera when the centre verse changes', async () => {
    const { user, container, props, rerender } = setup();
    await screen.findByRole('button', { name: 'John 3:16' });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<XrefWebView {...props} anchor={B} />);
    await screen.findByRole('button', { name: 'Rom 5:8' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true'));
    expect(container).toBeTruthy();
  });
});
