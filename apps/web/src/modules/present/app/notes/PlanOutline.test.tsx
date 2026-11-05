import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent as rtlFireEvent, act } from '@testing-library/preact';

// Test code passes plain Elements; the library types want HTMLElement.
const fireEvent = rtlFireEvent as unknown as {
  click(el: Element): void;
  keyDown(el: Element, init?: Record<string, unknown>): void;
};

const h = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  moveItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => (opts && typeof opts === 'object' && opts.defaultValue ? opts.defaultValue : key),
  }),
}));
vi.mock('../../../../hooks/useStore', () => ({ useStore: (_s: unknown, sel: () => unknown) => sel() }));
// dnd-kit is React-only and not under test here: stub it with a sortable that adds no behaviour of its own.
vi.mock('@dnd-kit/core', () => ({
  DndContext: (p: { children: unknown }) => p.children,
  closestCenter: () => [],
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: (p: { children: unknown }) => p.children,
  verticalListSortingStrategy: () => null,
  useSortable: () => ({
    attributes: { role: 'button', tabIndex: 0, 'aria-describedby': 'x' },
    listeners: {}, setNodeRef: () => {}, transform: null, transition: undefined, isDragging: false,
  }),
}));
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => undefined } } }));
vi.mock('../../lib/command', () => ({ focusCommandBox: () => true }));
vi.mock('./notesStore', () => ({
  notesStore: {
    get planItems() { return h.items; },
    livePlanItemId: null,
    removed: null,
    showPlanItem: vi.fn(),
    moveItem: h.moveItem,
    removeItem: h.removeItem,
    undoRemove: vi.fn(),
    openChooser: vi.fn(),
    addQuoteLine: vi.fn(),
  },
}));

import { PlanOutline } from './PlanOutline';

const entry = (id: string, label: string) => ({ id, label, status: 'ok', highlights: [], item: { kind: 'passage' } });

// 0209 R2 W7 item 1 and 11: the plan row's "More actions" menu behaves like a menu button.
describe('PlanOutline row menu', () => {
  beforeEach(() => {
    h.items = [entry('a', 'John 3:16'), entry('b', 'Psalm 23')];
    h.moveItem.mockClear();
    h.removeItem.mockClear();
  });

  const openFirst = (container: Element) => {
    const more = container.querySelectorAll<HTMLButtonElement>('.pn-plan__more')[0];
    more.focus();
    fireEvent.click(more);
    return more;
  };

  it('names each row control after its row', () => {
    const { container } = render(<PlanOutline />);
    const mores = Array.from(container.querySelectorAll('.pn-plan__more')).map((b) => b.getAttribute('aria-label'));
    expect(mores[0]).toContain('John 3:16');
    expect(mores[1]).toContain('Psalm 23');
    expect(container.querySelector('.pn-plan__grip')!.getAttribute('aria-label')).toContain('John 3:16');
  });

  it('keeps the drag handle out of the tab order and the accessibility tree', () => {
    const { container } = render(<PlanOutline />);
    const grip = container.querySelector('.pn-plan__grip')!;
    expect(grip.getAttribute('tabindex')).toBe('-1');
    expect(grip.getAttribute('aria-hidden')).toBe('true');
  });

  it('focuses the first enabled item on open and moves with the arrow keys', async () => {
    const { container } = render(<PlanOutline />);
    await act(async () => { openFirst(container); });
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    // Move up is disabled on the first row, so the first enabled item is Move down.
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('Escape closes the menu and returns focus to the row\'s More actions button', async () => {
    const { container } = render(<PlanOutline />);
    let more!: HTMLButtonElement;
    await act(async () => { more = openFirst(container); });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('keeps focus on the row\'s More actions after Move down', async () => {
    const { container } = render(<PlanOutline />);
    let more!: HTMLButtonElement;
    await act(async () => { more = openFirst(container); });
    const moveDown = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'))[1];
    await act(async () => { fireEvent.click(moveDown); });
    expect(h.moveItem).toHaveBeenCalledWith('a', 1);
    expect(document.activeElement).toBe(more);
  });

  it('after Remove, focus lands on the next row\'s More actions', async () => {
    const { container, rerender } = render(<PlanOutline />);
    await act(async () => { openFirst(container); });
    const remove = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')).pop()!;
    await act(async () => { fireEvent.click(remove); });
    expect(h.removeItem).toHaveBeenCalledWith('a');
    // Detection drops the row a moment later.
    h.items = [entry('b', 'Psalm 23')];
    await act(async () => { rerender(<PlanOutline />); });
    const only = container.querySelector('.pn-plan__more');
    expect(document.activeElement).toBe(only);
  });

  it('opening one row\'s menu closes another\'s', async () => {
    const { container } = render(<PlanOutline />);
    await act(async () => { openFirst(container); });
    const second = container.querySelectorAll<HTMLButtonElement>('.pn-plan__more')[1];
    await act(async () => { fireEvent.click(second); });
    expect(container.querySelectorAll('[role="menu"]')).toHaveLength(1);
  });
});
