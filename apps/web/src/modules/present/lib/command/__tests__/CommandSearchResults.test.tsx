import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => (o && typeof o === 'object' && o.defaultValue) || key }),
}));
vi.mock('../../../stores/presentStore', () => ({ presentStore: { rememberHymns: vi.fn() } }));

import { CommandSearchResults } from '../CommandSearchResults';
import { commandSearch } from '../commandSearch';

const verse = async () => [{ verseId: 43003016, module: 'KJV', reference: 'John 3:16', text: 'For God so loved' }];
const hymn = async () => [{ id: 'ag', title: 'Amazing Grace', firstLine: 'Amazing grace', hymnals: [] }];

async function mount(extra: Record<string, unknown> = {}) {
  const sink = vi.fn();
  const utils = render(
    <CommandSearchResults sink={sink} state={null} searchVerses={verse as never} searchHymns={hymn as never} {...extra} />,
  );
  await act(async () => { commandSearch.open('grace'); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  return { sink, ...utils };
}

describe('CommandSearchResults rows', () => {
  beforeEach(() => { commandSearch.close(); });

  it('gives every row a Show and an Add button; the body does not show', async () => {
    const onAdd = vi.fn();
    const { sink, container } = await mount({ onAddToNotes: onAdd });
    expect(container.querySelectorAll('.present-cmd-results__row')).toHaveLength(2);
    expect(container.querySelectorAll('.present-cmd-results__btn--primary')).toHaveLength(2);
    expect(container.querySelectorAll('.present-cmd-results__add')).toHaveLength(2);
    await act(async () => { fireEvent.click(container.querySelector('.present-cmd-results__pick')!); });
    expect(sink).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(container.querySelectorAll('.present-cmd-results__add')[1]); });
    expect(onAdd).toHaveBeenCalledWith({ kind: 'hymn', hymnId: 'ag' }, 'Amazing Grace');
  });

  it('Show button shows the item; addLabel relabels Add', async () => {
    const { sink, container } = await mount({ onAddToNotes: vi.fn(), addLabel: 'Add to list' });
    expect(container.querySelector('.present-cmd-results__add')!.textContent).toBe('Add to list');
    await act(async () => { fireEvent.click(container.querySelectorAll('.present-cmd-results__btn--primary')[1]); });
    expect(sink).toHaveBeenCalled();
  });
});
