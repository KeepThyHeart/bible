import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanZoom } from '@bible/core/browser';
import { GenealogyView } from './GenealogyView';
import type { GenealogyViewport } from './GenealogyView';
import { layout } from './testFixtures';

const svgOf = (c: HTMLElement) => c.querySelector('svg') as SVGSVGElement;
const vpEl = (c: HTMLElement) => c.querySelector('.kth-genealogy-viewport') as SVGGElement;
const labelsShown = (c: HTMLElement) => [...c.querySelectorAll('.kth-genealogy-node__label')].map((t) => t.textContent);

describe('GenealogyView', () => {
  it('renders nodes, edges and a screen-reader outline, fitted on mount', () => {
    const { container } = render(<GenealogyView layout={layout} />);
    expect(svgOf(container)).toHaveAttribute('role', 'graphics-document');
    expect(screen.getAllByRole('graphics-symbol')).toHaveLength(5);
    expect(container.querySelectorAll('.kth-genealogy-edge')).toHaveLength(3);
    const outline = screen.getByRole('list', { name: 'People in this tree' });
    expect(within(outline).getAllByRole('listitem')).toHaveLength(5);
    expect(vpEl(container).getAttribute('data-k')).toBe('1.5');
  });

  it('draws a double edge as two strokes and styles edges by kind', () => {
    const { container } = render(<GenealogyView layout={layout} />);
    expect(container.querySelector('[data-edge-id="l2"]')!.querySelectorAll('path')).toHaveLength(2);
    expect(container.querySelector('[data-edge-id="l3"]')).toHaveClass('kth-genealogy-edge--dashed', 'kth-genealogy-edge--cross');
    expect(container.querySelector('[data-edge-id="l1"]')).toHaveClass('kth-genealogy-edge--christ');
  });

  it('applies level of detail by zoom', () => {
    const at = (k: number) => {
      const { container, unmount } = render(<GenealogyView layout={layout} viewport={{ k, tx: 0, ty: 0 }} />);
      const shown = labelsShown(container);
      const dots = container.querySelectorAll('.kth-genealogy-node--dot').length;
      unmount();
      return { shown, dots };
    };
    expect(at(0.3)).toEqual({ shown: ['Abraham'], dots: 4 });
    expect(at(0.5).shown).toEqual(['Abraham', 'Isaac', 'Joseph']);
    expect(at(0.9).shown).toHaveLength(5);
  });

  it('marks flags: colour, christ, one-text, disputed, badge, gap, focus, selection', () => {
    const { container } = render(<GenealogyView layout={layout} selectedId="isaac" />);
    const g = (id: string) => container.querySelector(`[data-node-id="${id}"]`)!;
    expect(g('abraham')).toHaveClass('kth-genealogy-color-leah', 'kth-genealogy-node--christ');
    expect(g('abraham').querySelector('.kth-genealogy-node__christ-mark')).not.toBeNull();
    expect(g('jacob')).toHaveClass('kth-genealogy-node--one-text');
    expect(g('heli')).toHaveClass('kth-genealogy-node--disputed', 'kth-genealogy-node--female');
    expect(g('heli').querySelector('.kth-genealogy-node__badge')).toHaveTextContent('+3');
    expect(g('isaac').querySelector('.kth-genealogy-node__gap')).toHaveTextContent('3 kings not named');
    expect(g('joseph_h')).toHaveClass('kth-genealogy-node--focus');
    expect(g('isaac')).toHaveClass('kth-genealogy-node--selected');
    expect(g('isaac')).toHaveAttribute('aria-current', 'true');
    expect(g('heli')).toHaveAttribute('aria-label', 'Heli, disputed, 3 more hidden');
  });

  it('dims nodes off the line to Christ when highlighting', () => {
    const { container } = render(<GenealogyView layout={layout} highlight />);
    expect(container.querySelector('[data-node-id="jacob"]')).toHaveClass('kth-genealogy-node--dim');
    expect(container.querySelector('[data-node-id="abraham"]')).not.toHaveClass('kth-genealogy-node--dim');
  });

  it('wheel zoom is anchored at the pointer', () => {
    const changes: GenealogyViewport[] = [];
    const start = { k: 1, tx: 10, ty: 20 };
    const { container } = render(<GenealogyView layout={layout} viewport={start} onViewportChange={(v) => changes.push(v)} />);
    fireEvent.wheel(svgOf(container), { deltaY: -200, clientX: 100, clientY: 50 });
    const expected = new PanZoom(1, 10, 20).zoomAt(Math.exp(200 * 0.0015), 100, 50);
    expect(changes.at(-1)!.k).toBeCloseTo(expected.k);
    expect(changes.at(-1)!.tx).toBeCloseTo(expected.tx);
    expect(changes.at(-1)!.ty).toBeCloseTo(expected.ty);
  });

  it('drags to pan and does not select after a drag', () => {
    const onSelect = vi.fn();
    const { container } = render(<GenealogyView layout={layout} onSelect={onSelect} />);
    const svg = svgOf(container);
    const before = vpEl(container).getAttribute('transform');
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 130, clientY: 110 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(vpEl(container).getAttribute('transform')).not.toBe(before);
    const tx = (s: string | null) => Number(/translate\(([-\d.]+) ([-\d.]+)\)/.exec(s!)![1]);
    expect(tx(vpEl(container).getAttribute('transform')) - tx(before)).toBeCloseTo(30);
    fireEvent.click(container.querySelector('[data-node-id="isaac"]')!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('pinches: two pointers moving apart zoom in', () => {
    const changes: GenealogyViewport[] = [];
    const { container } = render(<GenealogyView layout={layout} viewport={{ k: 1, tx: 0, ty: 0 }} onViewportChange={(v) => changes.push(v)} />);
    const svg = svgOf(container);
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 200, clientY: 100, button: 0 });
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 300, clientY: 100 });
    expect(changes.at(-1)!.k).toBeCloseTo(2);
  });

  it('supports keyboard zoom, pan and Home to fit', async () => {
    const user = userEvent.setup();
    const { container } = render(<GenealogyView layout={layout} />);
    svgOf(container).focus();
    const k = () => Number(vpEl(container).getAttribute('data-k'));
    await user.keyboard('+');
    expect(k()).toBeCloseTo(1.8);
    await user.keyboard('-');
    await user.keyboard('-');
    expect(k()).toBeCloseTo(1.25);
    const before = vpEl(container).getAttribute('transform');
    await user.keyboard('{ArrowLeft}');
    expect(vpEl(container).getAttribute('transform')).not.toBe(before);
    await user.keyboard('{Home}');
    expect(k()).toBe(1.5);
  });

  it('Fit button refits after a change', async () => {
    const user = userEvent.setup();
    const { container } = render(<GenealogyView layout={layout} />);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(vpEl(container).getAttribute('data-k')).not.toBe('1.5');
    await user.click(screen.getByRole('button', { name: 'Fit to view' }));
    expect(vpEl(container).getAttribute('data-k')).toBe('1.5');
  });

  it('refits when the layout changes', () => {
    const { container, rerender } = render(<GenealogyView layout={layout} />);
    rerender(<GenealogyView layout={{ ...layout, bounds: { x: 0, y: 0, w: 1600, h: 1200 } }} />);
    // Fit would give 0.46, below the readable minimum, so it opens at MIN_FIT_SCALE.
    expect(vpEl(container).getAttribute('data-k')).toBe('0.5');
  });

  it('uses a roving tabindex, arrow keys move by coordinates, Enter and Space select', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<GenealogyView layout={layout} onSelect={onSelect} selectedId="abraham" />);
    const nodes = screen.getAllByRole('graphics-symbol');
    expect(nodes.filter((n) => n.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(nodes[0]).toHaveAttribute('tabindex', '0');
    nodes[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(nodes[1]);
    expect(nodes[1]).toHaveAttribute('tabindex', '0');
    expect(nodes[0]).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(nodes[3]);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('heli');
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('F on a node asks to focus the person; the outline buttons select', async () => {
    const user = userEvent.setup();
    const onFocusPerson = vi.fn();
    const onSelect = vi.fn();
    render(<GenealogyView layout={layout} onFocusPerson={onFocusPerson} onSelect={onSelect} />);
    screen.getAllByRole('graphics-symbol')[2].focus();
    await user.keyboard('f');
    expect(onFocusPerson).toHaveBeenCalledWith('jacob');
    const outline = screen.getByRole('list', { name: 'People in this tree' });
    await user.click(within(outline).getByRole('button', { name: /Isaac/ }));
    expect(onSelect).toHaveBeenCalledWith('isaac');
  });

  it('takes labels from props', () => {
    render(<GenealogyView layout={layout} labels={{ fit: 'Ajustar', graph: 'Árbol' }} />);
    expect(screen.getByRole('button', { name: 'Ajustar' })).toBeInTheDocument();
    expect(screen.getByLabelText('Árbol')).toBeInTheDocument();
  });
});
