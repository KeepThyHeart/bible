/**
 * Component tests for XrefGraphDialog. The shared views are mocked (they have their own tests);
 * these cover the frame: tabs, anchor sharing, navigation, Escape, focus and verse text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

const navigateTo = vi.fn();
vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    navigateTo: (...a: unknown[]) => navigateTo(...a),
    getActiveModule: () => 'KJV',
  },
}));
vi.mock('./XrefGraphProvider', () => ({ xrefGraphProvider: {} }));
vi.mock('../../utils/bookNames', () => ({ getLocalizedBookName: (n: number) => `Book${n}` }));

vi.mock('@bible/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@bible/ui');
  return {
    ...actual,
    XrefHopper: (p: any) => (
      <div data-testid="hopper" data-anchor={p.anchor}>
        <button onClick={() => p.onAnchorChange(2002002)}>rehop</button>
        <button onClick={() => p.onOpenVerse(43003016, 43003018)}>open</button>
        <button onClick={async () => { (window as any).__txt = await p.getVerseText(43003016, 43003017); }}>text</button>
      </div>
    ),
    XrefWebView: (p: any) => <div data-testid="web" data-anchor={p.anchor} />,
    XrefCompassView: (p: any) => <div data-testid="compass" data-anchor={p.anchor} />,
    XrefArcView: (p: any) => (
      <div data-testid="arcs" data-current={JSON.stringify(p.current)}>
        <button onClick={() => p.onExploreChapter(43, 3)}>explore</button>
        <input data-testid="arc-input" onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()} />
      </div>
    ),
  };
});

import { XrefGraphDialog } from './XrefGraphDialog';
import { xrefGraphStore } from './xrefGraphStore';

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
}

beforeEach(() => {
  xrefGraphStore.close();
  localStorage.clear();
  navigateTo.mockClear();
  setWidth(1024);
});

describe('XrefGraphDialog', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<XrefGraphDialog />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens on the verse web by default on wide screens with a tablist of four tabs', () => {
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByTestId('web').getAttribute('data-anchor')).toBe('43003016');
  });

  it('offers the compass tab and a full screen toggle', () => {
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016));
    fireEvent.click(screen.getByRole('tab', { name: 'Compass' }));
    expect(screen.getByTestId('compass').getAttribute('data-anchor')).toBe('43003016');
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.getByRole('dialog').className).toContain('kth-fs-on');
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeTruthy();
  });

  it('keeps a re-centred anchor when switching tabs', () => {
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016, 'hopper'));
    fireEvent.click(screen.getByText('rehop'));
    fireEvent.click(screen.getByRole('tab', { name: 'Verse web' }));
    expect(screen.getByTestId('web').getAttribute('data-anchor')).toBe('2002002');
  });

  it('gives the arc view the anchor chapter and explores into the web at verse 1', () => {
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016, 'arcs'));
    expect(screen.getByTestId('arcs').getAttribute('data-current')).toBe('{"book":43,"chapter":3}');
    fireEvent.click(screen.getByText('explore'));
    expect(xrefGraphStore.view).toBe('web');
    expect(screen.getByTestId('web').getAttribute('data-anchor')).toBe('43003001');
  });

  it('navigates the reader and stays open on wide screens', () => {
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016, 'hopper'));
    fireEvent.click(screen.getByText('open'));
    expect(navigateTo).toHaveBeenCalledWith(43, 3, 16, { endVerse: 18 });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes after navigating on phone-width screens', () => {
    setWidth(400);
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016, 'hopper'));
    fireEvent.click(screen.getByText('open'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape, but not when a view already handled it', () => {
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016, 'arcs'));
    fireEvent.keyDown(screen.getByTestId('arc-input'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes with the close button', () => {
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves focus into the dialog and back to the opener', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));
    act(() => xrefGraphStore.close());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('supplies tag-stripped verse text from the provider', async () => {
    const bibleProvider = {
      getVerseTexts: vi.fn(async () => ({
        verses: {
          '43003016': { text: '', text_html: 'For <i>God</i> so loved' },
          '43003017': { text: 'For God sent not' },
        },
      })),
    };
    render(<XrefGraphDialog bibleProvider={bibleProvider as any} />);
    act(() => xrefGraphStore.open(43003016, 'hopper'));
    fireEvent.click(screen.getByText('text'));
    await waitFor(() => expect((window as any).__txt).toBe('For God so loved For God sent not'));
    expect(bibleProvider.getVerseTexts).toHaveBeenCalledWith('KJV', [43003016, 43003017]);
  });

  it('returns undefined verse text without a provider', async () => {
    (window as any).__txt = 'unset';
    render(<XrefGraphDialog />);
    act(() => xrefGraphStore.open(43003016, 'hopper'));
    fireEvent.click(screen.getByText('text'));
    await waitFor(() => expect((window as any).__txt).toBeUndefined());
  });
});
