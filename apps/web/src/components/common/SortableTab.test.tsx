/**
 * Component tests for SortableTab.
 *
 * Pattern: Pure presentational component that wraps @dnd-kit/sortable.
 * The useSortable hook and CSS.Transform.toString are mocked to provide
 * predictable, deterministic output. Tests verify rendering, prop forwarding,
 * click handling, drag styles, and touch-action override.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// ---------------------------------------------------------------------------
// Mock @dnd-kit/sortable and @dnd-kit/utilities
// ---------------------------------------------------------------------------
const mockUseSortable = vi.hoisted(() => vi.fn());

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: mockUseSortable,
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: (t: unknown) => (t ? `translate(10px, 0px)` : ''),
    },
  },
}));

import { SortableTab } from './SortableTab';

// Default stub returned by useSortable
function makeSortableState(overrides: Partial<{
  isDragging: boolean;
  transform: unknown;
  transition: string | undefined;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown>;
  setNodeRef: (el: Element | null) => void;
}> = {}) {
  return {
    attributes: { role: 'tab', 'aria-roledescription': 'sortable' },
    listeners: { onKeyDown: vi.fn() },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
    ...overrides,
  };
}

describe('SortableTab', () => {
  beforeEach(() => {
    mockUseSortable.mockReturnValue(makeSortableState());
  });

  it('renders children inside the wrapper div', () => {
    render(<SortableTab id="tab-1">Hello Tab</SortableTab>);
    expect(screen.getByText('Hello Tab')).toBeTruthy();
  });

  it('applies the provided class name', () => {
    const { container } = render(
      <SortableTab id="tab-1" class="my-tab">Content</SortableTab>,
    );
    expect(container.querySelector('.my-tab')).toBeTruthy();
  });

  it('renders without a class when none is provided', () => {
    const { container } = render(<SortableTab id="tab-1">Content</SortableTab>);
    // div should still render but with no class attribute
    const div = container.firstElementChild as HTMLElement;
    expect(div).toBeTruthy();
    expect(div.className).toBe('');
  });

  it('forwards the title prop', () => {
    const { container } = render(
      <SortableTab id="tab-1" title="My Tab Title">Content</SortableTab>,
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div.title).toBe('My Tab Title');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const { container } = render(
      <SortableTab id="tab-1" onClick={onClick}>Click Me</SortableTab>,
    );
    fireEvent.click(container.firstElementChild!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onClick is not provided', () => {
    const { container } = render(<SortableTab id="tab-1">No Handler</SortableTab>);
    expect(() => fireEvent.click(container.firstElementChild!)).not.toThrow();
  });

  it('passes id to useSortable', () => {
    render(<SortableTab id="unique-id">Content</SortableTab>);
    expect(mockUseSortable).toHaveBeenCalledWith(expect.objectContaining({ id: 'unique-id' }));
  });

  it('passes disabled prop to useSortable', () => {
    render(<SortableTab id="tab-1" disabled>Content</SortableTab>);
    expect(mockUseSortable).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
  });

  it('applies opacity 0.5 when isDragging is true', () => {
    mockUseSortable.mockReturnValue(makeSortableState({ isDragging: true, transform: { x: 10, y: 0, scaleX: 1, scaleY: 1 } }));
    const { container } = render(<SortableTab id="tab-1">Dragging</SortableTab>);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.opacity).toBe('0.5');
  });

  it('applies zIndex 1 when isDragging is true', () => {
    mockUseSortable.mockReturnValue(makeSortableState({ isDragging: true }));
    const { container } = render(<SortableTab id="tab-1">Dragging</SortableTab>);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.zIndex).toBe('1');
  });

  it('does not apply opacity when not dragging', () => {
    mockUseSortable.mockReturnValue(makeSortableState({ isDragging: false }));
    const { container } = render(<SortableTab id="tab-1">Not Dragging</SortableTab>);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.opacity).toBe('');
  });

  it('applies transform style from CSS.Transform.toString when transform is set', () => {
    mockUseSortable.mockReturnValue(makeSortableState({ transform: { x: 10, y: 0, scaleX: 1, scaleY: 1 } }));
    const { container } = render(<SortableTab id="tab-1">Content</SortableTab>);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.transform).toBe('translate(10px, 0px)');
  });

  it('applies empty transform string when transform is null', () => {
    mockUseSortable.mockReturnValue(makeSortableState({ transform: null }));
    const { container } = render(<SortableTab id="tab-1">Content</SortableTab>);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.transform).toBe('');
  });

  it('applies touchAction style from prop when provided', () => {
    const { container } = render(
      <SortableTab id="tab-1" touchAction="pan-x">Content</SortableTab>,
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.touchAction).toBe('pan-x');
  });

  it('does not apply touchAction style when prop is not provided', () => {
    const { container } = render(<SortableTab id="tab-1">Content</SortableTab>);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.touchAction).toBe('');
  });

  it('applies transition style when transition is provided', () => {
    mockUseSortable.mockReturnValue(makeSortableState({ transition: 'transform 200ms' }));
    const { container } = render(<SortableTab id="tab-1">Content</SortableTab>);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.transition).toBe('transform 200ms');
  });

  it('spreads attributes from useSortable onto the div', () => {
    mockUseSortable.mockReturnValue(makeSortableState({
      attributes: { role: 'tab', 'aria-roledescription': 'sortable' },
    }));
    const { container } = render(<SortableTab id="tab-1">Content</SortableTab>);
    const div = container.firstElementChild as HTMLElement;
    expect(div.getAttribute('role')).toBe('tab');
  });

  it('renders complex children (JSX)', () => {
    const { container } = render(
      <SortableTab id="tab-1">
        <span class="inner">Inner Content</span>
      </SortableTab>,
    );
    expect(container.querySelector('.inner')).toBeTruthy();
    expect(screen.getByText('Inner Content')).toBeTruthy();
  });
});
