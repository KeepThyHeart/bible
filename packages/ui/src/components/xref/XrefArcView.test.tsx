import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHAPTER_COUNT, bookFirstChapterIndex } from '@bible/core/browser';
import type { ChapterArcs } from '@bible/core/browser';
import { XrefArcView, DEFAULT_XREF_ARCS_LABELS } from './XrefArcView';

const GEN = bookFirstChapterIndex(1);
const JOHN = bookFirstChapterIndex(43);
const PSALMS = bookFirstChapterIndex(19);

function makeArcs(rows: number[][]): ChapterArcs {
  const totals = new Uint32Array(CHAPTER_COUNT);
  for (const [a, b, w] of rows) { totals[a] += w; totals[b] += w; }
  return { chapterCount: CHAPTER_COUNT, pairs: Uint32Array.from(rows.flat()), chapterTotals: totals, fingerprint: 'x' };
}

// Genesis 1 <-> John 1 (heavy), Genesis 1 <-> John 3, Psalms 1 <-> John 1
const ARCS = makeArcs([
  [GEN, JOHN, 900, 5],
  [GEN, JOHN + 2, 500, 3],
  [PSALMS, JOHN, 300, 2],
]);

const NAMES: Record<number, string> = { 1: 'Genesis', 2: 'Exodus', 19: 'Psalms', 43: 'John' };
const bookName = (b: number) => NAMES[b] ?? `Book ${b}`;

const provider = (arcs: ChapterArcs = ARCS) => ({ getChapterArcs: vi.fn(() => Promise.resolve(arcs)) });

async function setup(props: Partial<Parameters<typeof XrefArcView>[0]> = {}) {
  const onOpenChapter = vi.fn();
  const p = props.provider ?? provider();
  const utils = render(<XrefArcView provider={p} onOpenChapter={onOpenChapter} bookName={bookName} {...props} />);
  const region = await screen.findByRole('application');
  return { onOpenChapter, p, region, user: userEvent.setup(), ...utils };
}

describe('XrefArcView', () => {
  it('renders without a canvas context and lists the most connected chapters first', async () => {
    await setup();
    expect(screen.getByText(DEFAULT_XREF_ARCS_LABELS.hint)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: DEFAULT_XREF_ARCS_LABELS.topChapters });
    expect(list.textContent).toContain('John 1');
    expect(screen.getByText('3 arcs shown')).toBeInTheDocument();
  });

  it('selects a chapter by keyboard and lists ranked partners', async () => {
    const { region, user } = await setup();
    region.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('list', { name: /Strongest connections of Genesis 1/ })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('John 1');
    expect(items[1]).toContain('John 3');
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('Genesis 1 selected: 2 connected chapters. Strongest: John 1.');
  });

  it('opens a partner chapter with book and chapter', async () => {
    const { region, user, onOpenChapter } = await setup();
    region.focus();
    await user.keyboard('{ArrowRight}');
    await user.click(screen.getByRole('button', { name: /John 3/ }));
    expect(onOpenChapter).toHaveBeenCalledWith(43, 3);
    await user.click(screen.getByRole('button', { name: 'Open Genesis 1' }));
    expect(onOpenChapter).toHaveBeenLastCalledWith(1, 1);
  });

  it('Enter opens, Escape clears, PageDown jumps a book', async () => {
    const { region, user, onOpenChapter } = await setup();
    region.focus();
    await user.keyboard('{ArrowRight}{PageDown}');
    expect(screen.getByRole('button', { name: 'Open Exodus 1' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onOpenChapter).toHaveBeenCalledWith(2, 1);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    expect(screen.getByText(DEFAULT_XREF_ARCS_LABELS.hint)).toBeInTheDocument();
  });

  it('a second Escape is not consumed, so the dialog can close', async () => {
    const { region, user } = await setup();
    region.focus();
    await user.keyboard('{ArrowRight}');
    const seen: boolean[] = [];
    const spy = (e: KeyboardEvent) => { if (e.key === 'Escape') seen.push(e.defaultPrevented); };
    document.addEventListener('keydown', spy);
    await user.keyboard('{Escape}{Escape}');
    document.removeEventListener('keydown', spy);
    expect(seen).toEqual([true, false]);
  });

  it('starts with the current chapter selected and offers explore', async () => {
    const onExploreChapter = vi.fn();
    const { user } = await setup({ current: { book: 43, chapter: 1 }, onExploreChapter });
    expect(screen.getByRole('button', { name: 'Open John 1' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Explore John 1' }));
    expect(onExploreChapter).toHaveBeenCalledWith(43, 1);
  });

  it('isolates a book and resets', async () => {
    const { user } = await setup();
    expect(screen.getByText('3 arcs shown')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Book' }), '19');
    expect(screen.getByText('1 arcs shown')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByText('3 arcs shown')).toBeInTheDocument();
    expect((screen.getByRole('combobox', { name: 'Book' }) as HTMLSelectElement).value).toBe('0');
  });

  it('isolates a book by clicking its segment on the bar', async () => {
    const { region } = await setup();
    // jsdom has no layout: width falls back to 640, height to 300; the bar is the bottom strip.
    const x = (PSALMS / CHAPTER_COUNT) * 640 + 1;
    fireEvent.click(region, { clientX: x, clientY: 295 });
    expect((screen.getByRole('combobox', { name: 'Book' }) as HTMLSelectElement).value).toBe('19');
  });

  it('toggles sections from the legend', async () => {
    const { user } = await setup();
    const btn = screen.getByRole('button', { name: /Pentateuch/ });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('1 arcs shown')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    render(<XrefArcView provider={provider(makeArcs([]))} onOpenChapter={() => {}} />);
    expect(await screen.findByText(DEFAULT_XREF_ARCS_LABELS.empty)).toBeInTheDocument();
  });

  it('shows an error and retries', async () => {
    const getChapterArcs = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(ARCS);
    const user = userEvent.setup();
    render(<XrefArcView provider={{ getChapterArcs }} onOpenChapter={() => {}} />);
    expect(await screen.findByText(DEFAULT_XREF_ARCS_LABELS.error)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('application')).toBeInTheDocument();
    expect(getChapterArcs).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale response', async () => {
    let resolveOld!: (a: ChapterArcs) => void;
    const oldP = { getChapterArcs: vi.fn(() => new Promise<ChapterArcs>((r) => { resolveOld = r; })) };
    const newP = provider(makeArcs([[GEN, JOHN, 100, 1]]));
    const { rerender } = render(<XrefArcView provider={oldP} onOpenChapter={() => {}} />);
    rerender(<XrefArcView provider={newP} onOpenChapter={() => {}} />);
    expect(await screen.findByText('1 arcs shown')).toBeInTheDocument();
    resolveOld(ARCS);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByText('1 arcs shown')).toBeInTheDocument();
  });

  it('draws with a context and batches one stroke per bucket', async () => {
    const calls = { stroke: 0, quad: 0 };
    const ctx = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === 'stroke') return () => { calls.stroke++; };
        if (prop === 'quadraticCurveTo') return () => { calls.quad++; };
        if (prop === 'measureText') return () => ({ width: 5 });
        return () => {};
      },
      set: () => true,
    });
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    try {
      await setup();
      await waitFor(() => expect(calls.quad).toBeGreaterThan(0));
      // 3 arcs per draw pass, at most one stroke per bucket (never per arc)
      expect(calls.quad % 3).toBe(0);
      expect(calls.stroke).toBeLessThanOrEqual(calls.quad);
    } finally {
      spy.mockRestore();
    }
  });
});
