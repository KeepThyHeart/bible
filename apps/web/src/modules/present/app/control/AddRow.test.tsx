import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent as rtlFireEvent, act } from '@testing-library/preact';

// Test code passes plain Elements; the library types want HTMLElement.
const fireEvent = rtlFireEvent as unknown as {
  click(el: Element): void;
  keyDown(el: Element, init?: Record<string, unknown>): void;
};

const h = vi.hoisted(() => ({ live: null as any, show: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => (o && typeof o === 'object' && o.defaultValue) || key }),
}));
vi.mock('../../../../hooks/useStore', () => ({ useStore: (_s: unknown, sel: () => unknown) => sel() }));
vi.mock('../../../../stores/moduleStore', () => ({
  moduleStore: { getBibleModules: () => [{ abbreviation: 'KJV' }, { abbreviation: 'ESV' }], getBookName: (n: number) => `Book${n}` },
}));
vi.mock('../../../../constants', () => ({ MAX_CHAPTERS: { 43: 21 } }));
vi.mock('../../../../stores/settingsStore', () => ({ settingsStore: { getDefaultBible: () => 'KJV' } }));
vi.mock('../../stores/presentStore', () => ({ presentStore: { addToPlan: vi.fn(), rememberHymns: vi.fn() } }));
vi.mock('../presenterSink', () => ({ presenterShow: h.show, usePresenterState: () => ({ live: h.live }) }));
vi.mock('../../../../utils/apiUrl', () => ({ API_BASE: '' }));

import { AddRow } from './AddRow';
import { VersePicker } from './VersePicker';

// 0209 R2 W7 items 4 and 12: the picker panel hands focus back, closes on Escape, opens at the current verse.
describe('AddRow', () => {
  const button = (root: Element, name: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === name) as HTMLButtonElement;

  it('"Add to notes" collapses the panel and focuses the Verse button that opened it', async () => {
    const onAdd = vi.fn();
    const { container } = render(<AddRow onAddToNotes={onAdd} />);
    const verse = button(container, 'present.control.verse');
    await act(async () => { fireEvent.click(verse); });
    await act(async () => { fireEvent.click(button(container, 'present.control.addToNotes')); });
    expect(onAdd).toHaveBeenCalled();
    expect(container.querySelector('.pz-picker')).toBeNull();
    expect(document.activeElement).toBe(verse);
  });

  it('Escape closes an open picker and focuses its button', async () => {
    const { container } = render(<AddRow />);
    const verse = button(container, 'present.control.verse');
    await act(async () => { fireEvent.click(verse); });
    const select = container.querySelector('select')!;
    select.focus();
    await act(async () => { fireEvent.keyDown(select, { key: 'Escape', bubbles: true }); });
    expect(container.querySelector('.pz-picker')).toBeNull();
    expect(document.activeElement).toBe(verse);
  });
});

describe('VersePicker seed', () => {
  it('opens at the passage on screen', () => {
    h.live = { kind: 'passage', module: 'ESV', book: 43, chapter: 3, verseStart: 16 };
    const { container } = render(<VersePicker onDone={() => {}} />);
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('3');
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('ESV');
    h.live = null;
  });

  it('starts at John 1 when nothing is on screen', () => {
    h.live = null;
    const { container } = render(<VersePicker onDone={() => {}} />);
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('1');
  });
});
