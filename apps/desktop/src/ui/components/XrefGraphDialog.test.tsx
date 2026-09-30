import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { useXrefGraphStore } from '../stores/useXrefGraphStore';

const hoisted = vi.hoisted(() => ({
  navigate: vi.fn(),
  getVerses: vi.fn(),
  hopperProps: null as any,
  webProps: null as any,
  arcProps: null as any,
}));

vi.mock('@bible/ui', async () => {
  const actual = await vi.importActual<typeof import('@bible/ui')>('@bible/ui');
  return {
    ...actual,
    XrefHopper: (p: any) => { hoisted.hopperProps = p; return <div data-testid="hopper">{p.anchor}</div>; },
    XrefWebView: (p: any) => { hoisted.webProps = p; return <div data-testid="web">{p.anchor}</div>; },
    XrefConstellationView: (p: any) => <div data-testid="constellation">{p.anchor}</div>,
    XrefArcView: (p: any) => {
      hoisted.arcProps = p;
      return <div data-testid="arcs" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault(); }} />;
    },
  };
});
vi.mock('../services/xrefGraphProvider', () => ({ xrefGraphProvider: {} }));
vi.mock('../services/verseFetchCache', () => ({ getVersesCached: hoisted.getVerses }));
vi.mock('../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: () => ({ openTabs: [{ abbreviation: 'KJV' }], activeTabIndex: 0 }),
}));
vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    (sel: (s: any) => unknown) => sel({ getDefaultBible: () => 'KJV' }),
    { getState: () => ({ navigateToVerseInPrimary: hoisted.navigate }) },
  ),
}));

import XrefGraphDialog from './XrefGraphDialog';

function renderDialog() {
  const services = {
    registry: {},
    whenContext: {},
    keybindings: {},
    i18n: {
      t: (k: string) => `[${k}]`,
      currentLocale: 'en',
      currentDirection: 'ltr',
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
    },
  } as unknown as AppServices;
  return render(<ContextProvider services={services}><XrefGraphDialog /></ContextProvider>);
}

const open = (view?: 'hopper' | 'web' | 'arcs') =>
  act(() => useXrefGraphStore.getState().openGraph(43003016, view));

describe('XrefGraphDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    useXrefGraphStore.setState({ isOpen: false, anchor: null, view: 'web' });
  });

  it('renders nothing while closed', () => {
    renderDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows an accessible dialog with English fallbacks and a tablist', () => {
    renderDialog();
    open();
    const dialog = screen.getByRole('dialog', { name: 'Cross-reference graph' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Graph views' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Hopper', 'Verse web', 'Constellation', 'Canon arcs']);
    expect(screen.getByTestId('web')).toHaveTextContent('43003016');
  });

  it('switches views and keeps the anchor when a view re-centres', () => {
    renderDialog();
    open('hopper');
    expect(screen.getByTestId('hopper')).toBeInTheDocument();
    act(() => hoisted.hopperProps.onAnchorChange(19023001));
    fireEvent.click(screen.getByRole('tab', { name: 'Verse web' }));
    expect(screen.getByTestId('web')).toHaveTextContent('19023001');
    fireEvent.click(screen.getByRole('tab', { name: 'Canon arcs' }));
    expect(hoisted.arcProps.current).toEqual({ book: 19, chapter: 23 });
  });

  it('shows the constellation tab and toggles full screen', () => {
    renderDialog();
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Constellation' }));
    expect(screen.getByTestId('constellation')).toHaveTextContent('43003016');
    const btn = screen.getByRole('button', { name: 'Full screen' });
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('dialog').className).toContain('w-screen');
  });

  it('explores a chapter from the arcs in the verse web at verse 1', () => {
    renderDialog();
    open('arcs');
    act(() => hoisted.arcProps.onExploreChapter(45, 8));
    expect(screen.getByTestId('web')).toHaveTextContent('45008001');
  });

  it('navigates the reader and stays open on wide screens, closes on phones', () => {
    renderDialog();
    open('web');
    act(() => hoisted.webProps.onOpenVerse(45008028));
    expect(hoisted.navigate).toHaveBeenCalledWith(45008028);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    act(() => hoisted.webProps.onOpenVerse(45008029));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('formats references with localized book names', () => {
    renderDialog();
    open('web');
    expect(hoisted.webProps.formatRef(43003016)).toBe('John 3:16');
    expect(hoisted.webProps.formatRef(43003016, 43003018)).toBe('John 3:16-18');
  });

  it('gets plain verse text for the active translation', async () => {
    hoisted.getVerses.mockResolvedValue([{ text: 'For <i>God</i> so  loved' }, { text: 'the world' }]);
    renderDialog();
    open('web');
    const text = await hoisted.webProps.getVerseText(43003016, 43003017);
    expect(hoisted.getVerses).toHaveBeenCalledWith('KJV', 43003016, 43003017);
    expect(text).toBe('For God so loved the world');
    hoisted.getVerses.mockRejectedValue(new Error('x'));
    expect(await hoisted.webProps.getVerseText(1001001)).toBeUndefined();
  });

  it('closes on Escape and via the close button, but not when a view handled Escape', () => {
    renderDialog();
    open('arcs');
    fireEvent.keyDown(screen.getByTestId('arcs'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    open('web');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves between tabs with the arrow keys', () => {
    renderDialog();
    open('hopper');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Hopper' }), { key: 'ArrowRight' });
    expect(useXrefGraphStore.getState().view).toBe('web');
  });
});
