/** W-038: the hook returns focus on Escape/Tab/action, and opens from Shift+F10 / the ContextMenu key. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';

vi.mock('../stores/bibleStore', () => ({
  bibleStore: {
    adoptPreviewAsStudy: vi.fn(),
    getActiveTab: () => ({ moduleAbbr: 'KJV', studyVerse: 43003016 }),
    getSelectedRange: () => null,
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d: string) => d, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init() {} },
}));
vi.mock('../host/useIsActiveApp', () => ({ useIsActiveApp: () => true }));
vi.mock('../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { useContextMenu } from './useContextMenu';

let main: HTMLElement;
beforeEach(() => {
  document.body.innerHTML =
    '<main id="main-content" tabindex="-1"><div class="bible-content"><span class="verse" data-verse-id="43003016">16</span></div></main>';
  main = document.getElementById('main-content')!;
});

function setup() {
  const setCopyOpen = vi.fn();
  const r = renderHook(() => useContextMenu(() => null, setCopyOpen));
  return { r, setCopyOpen };
}
const key = (el: Element, init: KeyboardEventInit) =>
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });

describe('useContextMenu keyboard (W-038)', () => {
  it('Shift+F10 on the reading region opens the menu for the selected verse', () => {
    const { r } = setup();
    main.focus();
    key(main, { key: 'F10', shiftKey: true });
    expect(r.result.current.contextMenu?.verseId).toBe(43003016);
  });

  it('the ContextMenu key opens it too, but not from a text field', () => {
    const { r } = setup();
    const input = document.createElement('input');
    main.appendChild(input);
    input.focus();
    key(input, { key: 'ContextMenu' });
    expect(r.result.current.contextMenu).toBeNull();
    main.focus();
    key(main, { key: 'ContextMenu' });
    expect(r.result.current.contextMenu).not.toBeNull();
  });

  it('Escape closes and returns focus to where it was', () => {
    const { r } = setup();
    const btn = document.createElement('button');
    main.querySelector('.bible-content')!.appendChild(btn);
    btn.focus();
    key(btn, { key: 'F10', shiftKey: true });
    expect(r.result.current.contextMenu).not.toBeNull();
    main.focus(); // focus moved into the menu
    key(main, { key: 'Escape' });
    expect(r.result.current.contextMenu).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('Tab closes the menu instead of walking into the page behind', () => {
    const { r } = setup();
    main.focus();
    key(main, { key: 'ContextMenu' });
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(r.result.current.contextMenu).toBeNull();
    expect(document.activeElement).toBe(main);
  });

  it('running an action restores focus before the dialog records its opener', () => {
    const { r, setCopyOpen } = setup();
    const btn = document.createElement('button');
    main.querySelector('.bible-content')!.appendChild(btn);
    btn.focus();
    key(btn, { key: 'ContextMenu' });
    main.focus();
    setCopyOpen.mockImplementation(() => expect(document.activeElement).toBe(btn));
    act(() => r.result.current.handleContextMenuAction('copy'));
    expect(setCopyOpen).toHaveBeenCalledWith(true);
  });
});
