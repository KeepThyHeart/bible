/**
 * DesktopApp: the side-pane mode switcher is a tablist (role=tab, aria-selected, roving tabindex).
 * Everything the shell composes is mocked; only the switcher is under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => (typeof o === 'string' ? o : o?.defaultValue ?? k), i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

const { stub, h } = vi.hoisted(() => ({
  stub: (_name: string) => () => null,
  h: { rightPaneMode: 'commentary', setRightPaneMode: undefined as any },
}));
vi.mock('./components/BiblePane/BiblePane', () => ({ BiblePane: stub('bible') }));
vi.mock('./components/CommentaryPane/CommentaryPane', () => ({ CommentaryPane: stub('commentary') }));
vi.mock('./components/Search/SearchResultsPanel', () => ({ SearchResultsPanel: stub('search-panel') }));
vi.mock('./components/StudyPane/StudyPane', () => ({ StudyPane: stub('study') }));
vi.mock('./components/StudyPane/TopicsPane', () => ({ TopicsPane: stub('topics') }));
vi.mock('./components/DictionaryPane/DictionaryPane', () => ({ DictionaryPane: stub('dictionary') }));
vi.mock('./components/Header', () => ({ Header: stub('header') }));
vi.mock('./components/common/ResizeHandle', () => ({ ResizeHandle: stub('resize') }));
vi.mock('./components/common/DialogLayer', () => ({ DialogLayer: stub('dialogs') }));
vi.mock('./components/common/ContextMenuPopup', () => ({ ContextMenuPopup: stub('ctx') }));
vi.mock('./components/SiteBanners', () => ({ SiteBanners: stub('banners') }));
vi.mock('./components/ConnectionBanner', () => ({ ConnectionBanner: stub('conn') }));
vi.mock('./components/UpdateBanner', () => ({ UpdateBanner: stub('update') }));
vi.mock('./host/CompanionSlot', () => ({ CompanionSlot: stub('companion') }));
vi.mock('./host/slots', () => ({ StudyLayoutOutlet: stub('outlet') }));
vi.mock('./modules/moduleHost', () => ({ fireActivation: vi.fn() }));
vi.mock('./modules/host/LazyPane', () => ({ LazyPane: stub('lazy') }));
vi.mock('./modules/host/usePaneModes', () => ({
  usePaneModes: () => [
    { id: 'study', title: 'Study' },
    { id: 'commentary', title: 'Commentary' },
    { id: 'dictionary', title: 'Dictionary' },
  ],
}));
vi.mock('./host/appNavEntries', () => ({ resolveLabel: (_t: unknown, title: string) => title }));
vi.mock('./host/verseActionWhen', () => ({ evalVerseWhen: () => true, whenKeys: {} }));
vi.mock('./host/useReadable', () => ({ useReadable: () => 0 }));
vi.mock('./hooks/useModalFocus', () => ({ setModalFallback: vi.fn() }));
vi.mock('./utils/clientConfig', () => ({ isTagGraphEnabled: () => false }));
vi.mock('./utils/verseId', () => ({ parseVerseId: () => ({ bookNumber: 1, chapter: 1 }) }));
vi.mock('./stores/dictionaryStore', () => ({ dictionaryStore: { openStrongs: vi.fn() } }));
vi.mock('./stores/bibleStore', () => ({ bibleStore: { adoptPreviewAsStudy: vi.fn() } }));
vi.mock('./stores/searchStore', () => ({ searchStore: {} }));
vi.mock('./stores/settingsStore', () => ({ pxToRem: (n: number) => `${n}px` }));

vi.mock('./stores/commentaryStore', () => ({
  commentaryStore: {
    setRightPaneMode: (m: string) => h.setRightPaneMode(m),
    expand: vi.fn(),
    toggleCollapsed: vi.fn(),
    loadForChapter: vi.fn(),
    reconcilePaneMode: vi.fn(),
  },
}));

vi.mock('./hooks/useAppShared', () => ({
  useAppShared: () => ({
    rightPaneMode: h.rightPaneMode, collapsed: false, searchIsOpen: false, searchSeq: 0,
    fontFamily: '', fontSize: 16, lineHeight: 1.5, headingFontFamily: '', studyFontFamily: '', studyLineHeight: 1.5,
    setStrongsPopup: vi.fn(), handleStrongsLeave: vi.fn(), handleStrongsHover: vi.fn(), openSettings: vi.fn(),
    setHelpOpen: vi.fn(), setCopyOpen: vi.fn(), findVerseAtPoint: vi.fn(),
  }),
}));
vi.mock('./hooks/useContextMenu', () => ({
  useContextMenu: () => ({ contextMenu: null, contextMenuRef: { current: null }, handleContextMenuAction: vi.fn(), handleVerseAction: vi.fn(), verseActionItems: [] }),
}));

import { DesktopApp } from './DesktopApp';
const setRightPaneMode = (h.setRightPaneMode = vi.fn());

describe('DesktopApp side-pane switcher', () => {
  beforeEach(() => { h.rightPaneMode = 'commentary'; setRightPaneMode.mockClear(); });

  it('is a tablist whose tabs expose aria-selected and a roving tabindex', () => {
    render(<DesktopApp providers={{} as any} />);
    const list = screen.getByRole('tablist', { name: 'Side pane views' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Study', 'Commentary', 'Dictionary']);
    expect(tabs.every(t => list.contains(t))).toBe(true);
    expect(screen.getByRole('tab', { name: 'Commentary' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Study' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Commentary' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Study' }).getAttribute('tabindex')).toBe('-1');
  });

  it('keeps the data-testid hooks and the collapse button outside the tablist', () => {
    const { container } = render(<DesktopApp providers={{} as any} />);
    expect(container.querySelector('[data-testid="right-pane-tab-dictionary"]')).toBeTruthy();
    expect(container.querySelector('.right-pane-tabs__collapse')!.closest('[role="tablist"]')).toBeNull();
  });

  it('arrow keys move focus along the tabs; click selects', () => {
    render(<DesktopApp providers={{} as any} />);
    const commentary = screen.getByRole('tab', { name: 'Commentary' });
    commentary.focus();
    fireEvent.keyDown(commentary, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Dictionary' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Study' }));
    expect(setRightPaneMode).toHaveBeenCalledWith('study');
  });
});
