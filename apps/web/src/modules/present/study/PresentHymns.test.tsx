import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => (o && typeof o === 'object' && o.defaultValue) || key }),
}));
vi.mock('../../../utils/apiUrl', () => ({ API_BASE: '' }));
vi.mock('../stores/presentStore', () => ({ presentStore: { rememberHymns: vi.fn(), addToPlan: vi.fn() } }));
vi.mock('../app/presenterSink', () => ({ presenterShow: vi.fn() }));

import { PresentHymns } from './PresentHymns';
import { presenterShow } from '../app/presenterSink';

// 0209 R2 W7 item 12: the Hymn picker opens ready to type, names each row's Add button, and confirms an add.
describe('PresentHymns', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ total: 1, hymns: [{ id: 'ag', title: 'Amazing Grace', firstLine: 'Amazing grace', hymnals: [] }] }),
    })));
  });

  it('focuses the search box when it opens', async () => {
    const { container } = render(<PresentHymns />);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(document.activeElement).toBe(container.querySelector('.present-hymns__search'));
  });

  it('names Add to notes after the hymn and announces the add', async () => {
    const onAdd = vi.fn();
    const { container, getByRole } = render(<PresentHymns onAddToNotes={onAdd} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const add = container.querySelector<HTMLButtonElement>('.present-hymns__add')!;
    expect(add.getAttribute('aria-label')).toContain('Amazing Grace');
    await act(async () => { fireEvent.click(add); });
    expect(onAdd).toHaveBeenCalledWith({ kind: 'hymn', hymnId: 'ag' });
    expect(getByRole('status').textContent).toContain('Amazing Grace');
  });

  it('shows only from the labelled Show button, not from the row body', async () => {
    const { container, getByText } = render(<PresentHymns />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    fireEvent.click(container.querySelector('.present-hymns__title')!);
    expect(presenterShow).not.toHaveBeenCalled();
    expect(getByText('Show')).toBe(container.querySelector('.present-hymns__pick'));
    fireEvent.click(container.querySelector('.present-hymns__pick')!);
    expect(presenterShow).toHaveBeenCalledWith({ kind: 'hymn', hymnId: 'ag' });
  });

  it('uses addLabel for the Add button', async () => {
    const { container } = render(<PresentHymns addLabel="Add to list" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const add = container.querySelector('.present-hymns__add')!;
    expect(add.textContent).toBe('Add to list');
    expect(add.getAttribute('aria-label')).toBe('Add to list: Amazing Grace');
  });
});
