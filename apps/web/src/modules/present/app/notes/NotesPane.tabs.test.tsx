import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent as rtlFireEvent, act } from '@testing-library/preact';

const fireEvent = rtlFireEvent as unknown as { keyDown(el: Element, init?: Record<string, unknown>): void };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => (o && typeof o === 'object' && o.defaultValue) || key }),
}));
vi.mock('../../../../hooks/useStore', () => ({ useStore: (_s: unknown, sel: () => unknown) => sel() }));
vi.mock('../../lib/command', () => ({ focusCommandBox: () => true }));
vi.mock('./editor/LazyNotesEditor', () => ({ LazyNotesEditor: (p: { placeholder?: string }) => <div data-testid="editor" data-placeholder={p.placeholder} /> }));
vi.mock('./SuggestionBar', () => ({ SuggestionBar: () => <div data-testid="suggest" /> }));
vi.mock('./SelectionPopup', () => ({ SelectionPopup: () => <div data-testid="selpop" /> }));
vi.mock('./ItemChooser', () => ({ ItemChooser: () => null }));
vi.mock('./PlanOutline', () => ({ PlanOutline: () => <div data-testid="plan" /> }));
vi.mock('./notesStore', () => ({
  notesStore: { doc: null, chooser: null, setTranslate: () => {}, init: async () => {}, plugins: [], onDocChange: () => {}, attachView: () => {}, showAtCaret: () => {} },
}));

import { NotesPane } from './NotesPane';

describe('NotesPane tablist', () => {
  it('is named, uses roving tabindex and arrow/Home/End keys', async () => {
    const { container } = render(<NotesPane />);
    const list = container.querySelector('[role="tablist"]')!;
    expect(list.getAttribute('aria-label')).toBeTruthy();
    const tabs = () => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs().map((x) => x.tabIndex)).toEqual([0, -1]);
    tabs()[0].focus();
    await act(async () => { fireEvent.keyDown(tabs()[0], { key: 'ArrowRight' }); });
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs().map((x) => x.tabIndex)).toEqual([-1, 0]);
    await act(async () => { fireEvent.keyDown(tabs()[1], { key: 'Home' }); });
    expect(document.activeElement).toBe(tabs()[0]);
    await act(async () => { fireEvent.keyDown(tabs()[0], { key: 'End' }); });
    expect(document.activeElement).toBe(tabs()[1]);
    await act(async () => { fireEvent.keyDown(tabs()[1], { key: 'ArrowLeft' }); });
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('mounts the suggestion bar and selection popup with the editor only, and passes the placeholder', async () => {
    const { container } = render(<NotesPane />);
    const editor = container.querySelector('[data-testid="editor"]')!;
    expect(editor.getAttribute('data-placeholder')).toMatch(/^Type or paste notes here\./);
    expect(container.querySelector('[data-testid="suggest"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="selpop"]')).not.toBeNull();
    const plan = container.querySelectorAll<HTMLElement>('[role="tab"]')[1];
    await act(async () => { plan.click(); });
    expect(container.querySelector('[data-testid="suggest"]')).toBeNull();
    expect(container.querySelector('[data-testid="selpop"]')).toBeNull();
  });
});
