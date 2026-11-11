import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent as rtlFireEvent, act } from '@testing-library/preact';

const fireEvent = rtlFireEvent as unknown as { click(el: Element): void };

const h = vi.hoisted(() => ({
  show: vi.fn(),
  store: { items: [] as any[], remove: vi.fn(), clear: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { defaultValue?: string; label?: string; count?: number }) =>
      (o?.defaultValue || key).replace('{label}', o?.label ?? '').replace('{count}', String(o?.count ?? '')),
  }),
}));
vi.mock('../../../../hooks/useStore', () => ({ useStore: (_s: unknown, sel: () => unknown) => sel() }));
vi.mock('../../stores/shownStore', () => ({ shownStore: h.store }));
vi.mock('../presenterSink', () => ({ presenterShow: h.show }));

import { ShownList } from './ShownList';

const passage = (id: string, v: number) => ({
  id, label: `John 3:${v}`, item: { kind: 'passage', module: 'KJV', book: 43, chapter: 3, verseStart: v },
});

describe('ShownList', () => {
  beforeEach(() => { vi.clearAllMocks(); h.store.items = []; });

  it('renders nothing when empty', () => {
    const { container } = render(<ShownList />);
    expect(container.innerHTML).toBe('');
  });

  it('Show re-shows the item at its verse', async () => {
    h.store.items = [passage('a', 16)];
    const { getByLabelText } = render(<ShownList />);
    await act(async () => { fireEvent.click(getByLabelText('Show John 3:16')); });
    expect(h.show).toHaveBeenCalledWith(h.store.items[0].item, 16);
  });

  it('Add to notes adds then removes; hidden without the prop', async () => {
    h.store.items = [passage('a', 16)];
    const onAdd = vi.fn();
    const { getByLabelText, queryByLabelText, rerender } = render(<ShownList />);
    expect(queryByLabelText('Add John 3:16 to notes')).toBeNull();
    rerender(<ShownList onAddToNotes={onAdd} />);
    await act(async () => { fireEvent.click(getByLabelText('Add John 3:16 to notes')); });
    expect(onAdd).toHaveBeenCalledWith(h.store.items[0].item, 'John 3:16');
    expect(h.store.remove).toHaveBeenCalledWith('a');
  });

  it('Clear empties the store; long lists collapse behind a more button', async () => {
    h.store.items = Array.from({ length: 8 }, (_, i) => passage(`i${i}`, i + 1));
    const { container, getByText } = render(<ShownList />);
    expect(container.querySelectorAll('li').length).toBe(6);
    await act(async () => { fireEvent.click(getByText('2 more')); });
    expect(container.querySelectorAll('li').length).toBe(8);
    await act(async () => { fireEvent.click(getByText('Clear')); });
    expect(h.store.clear).toHaveBeenCalled();
  });
});
