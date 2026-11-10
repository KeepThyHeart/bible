/**
 * Settings opened from the Theme popup's "More…": the popup item unmounts as the dialog opens, so
 * focus must come back to the Theme button when Settings closes (not fall to <body>).
 * Real Header + a real useModalFocus dialog, wired the way DesktopApp wires onSettingsClick.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));
vi.mock('../stores/settingsStore', () => ({
  settingsStore: { getResolvedTheme: () => 'light', setTheme: vi.fn() },
}));
vi.mock('../stores/searchStore', () => ({
  searchStore: {
    searchType: 'keyword', query: '', clearSeq: 0, clear: vi.fn(), performSearch: vi.fn(),
    setSearchType: vi.fn(), warmupSemanticSearch: () => Promise.resolve(),
  },
}));
vi.mock('../stores/offlineStore', () => ({ offlineStore: { isOnline: true, enabled: false } }));
vi.mock('../stores/bibleStore', () => ({
  bibleStore: { getActiveTab: () => ({ book: 43, chapter: 3, moduleAbbr: 'KJV' }), navigateTo: vi.fn(), openBookPicker: vi.fn() },
}));
vi.mock('../utils/bookNames', () => ({
  getAllBookNames: () => ({ '43': 'John' }),
  getLocalizedBookName: (n: number) => `Book${n}`,
}));

import { Header } from './Header';
import { useModalFocus, setModalFallback } from '../hooks/useModalFocus';

function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(open, ref);
  if (!open) return null;
  return <div ref={ref} role="dialog" aria-label="Settings"><button onClick={onClose}>Close</button></div>;
}

function App() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Header
        onSettingsClick={() => {
          const from = document.activeElement;
          if (from instanceof HTMLElement && from !== document.body) {
            setModalFallback(from, document.querySelector<HTMLElement>('.header__theme-wrapper > button'));
          }
          // State lives in the parent, as in DesktopApp: one render patches Header (the popup and its
          // "More" item go, focus falls to body) before the dialog below it renders.
          setOpen(true);
        }}
      />
      <Settings open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const flush = () => new Promise((r) => setTimeout(r, 80));

describe('Header Theme popup -> Settings focus return', () => {
  afterEach(cleanup);

  it('returns focus to the Theme button when Settings closes', async () => {
    render(<App />);
    const themeBtn = screen.getByTitle('header.theme');
    fireEvent.click(themeBtn);
    await flush();
    const more = screen.getByText('header.more').closest('button') as HTMLElement;
    more.focus();
    fireEvent.click(more);
    await flush();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByText('Close'));
    await flush();
    expect(document.activeElement).toBe(themeBtn);
  });
});
