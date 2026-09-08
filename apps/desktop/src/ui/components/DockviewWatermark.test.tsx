import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import DockviewWatermarkImpl from './DockviewWatermark';
// The real component receives a `containerApi` from Dockview at runtime; the
// tests only assert presentational behaviour and don't exercise the API, so
// widen the props to make it callable without one.
const DockviewWatermark = DockviewWatermarkImpl as unknown as React.FC;
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { useLayoutStore } from '../stores/useLayoutStore';

function createMockI18n() {
  return {
    t: (key: string) => {
      const map: Record<string, string> = {
        'dockviewWatermark.emptyMessage': 'No panels open. Add a panel:',
        // The buttons render `localizePaneLabel(...)`, so these must resolve to
        // real text. Asserting on raw keys instead would let a mistyped key pass.
        'paneName.bible': 'Bible',
        'paneName.commentary': 'Commentary',
        'paneName.book': 'Books',
        'paneName.dictionary': 'Dictionary',
        'paneName.notes': 'Notes',
        'paneName.prayer': 'Prayer',
      };
      return map[key] || key;
    },
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  };
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: createMockI18n() as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ContextProvider services={createMockServices()}>{ui}</ContextProvider>
  );
}

describe('DockviewWatermark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays empty message', () => {
    renderWithProviders(<DockviewWatermark />);

    expect(
      screen.getByText(/No panels open. Add a panel/i)
    ).toBeInTheDocument();
  });

  it('renders add panel buttons', () => {
    renderWithProviders(<DockviewWatermark />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(6);
  });

  it('renders Bible panel button', () => {
    renderWithProviders(<DockviewWatermark />);

    expect(screen.getByText('Bible')).toBeInTheDocument();
  });

  it('renders Commentary panel button', () => {
    renderWithProviders(<DockviewWatermark />);

    expect(screen.getByText('Commentary')).toBeInTheDocument();
  });

  it('renders Books panel button', () => {
    renderWithProviders(<DockviewWatermark />);

    expect(screen.getByText('Books')).toBeInTheDocument();
  });

  it('renders Dictionary panel button', () => {
    renderWithProviders(<DockviewWatermark />);

    expect(screen.getByText('Dictionary')).toBeInTheDocument();
  });

  it('renders Notes panel button', () => {
    renderWithProviders(<DockviewWatermark />);

    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('renders Prayer panel button', () => {
    renderWithProviders(<DockviewWatermark />);

    expect(screen.getByText('Prayer')).toBeInTheDocument();
  });

  it('displays emoji icons for each panel', () => {
    renderWithProviders(<DockviewWatermark />);

    // Check for emoji characters
    const container = document.body.textContent || '';
    expect(container).toContain('📖'); // Bible emoji
    expect(container).toContain('📝'); // Notes emoji
  });

  it('calls addPanel when Bible button is clicked', async () => {
    const user = userEvent.setup();
    const addPanel = vi.fn();
    useLayoutStore.setState({ addPanel });

    renderWithProviders(<DockviewWatermark />);

    const bibleButton = screen.getByRole('button', { name: /Bible/i });
    await user.click(bibleButton);

    expect(addPanel).toHaveBeenCalledWith('bible', undefined, 'Bible');
  });

  it('calls addPanel when Commentary button is clicked', async () => {
    const user = userEvent.setup();
    const addPanel = vi.fn();
    useLayoutStore.setState({ addPanel });

    renderWithProviders(<DockviewWatermark />);

    const commentaryButton = screen.getByRole('button', {
      name: /Commentary/i,
    });
    await user.click(commentaryButton);

    expect(addPanel).toHaveBeenCalledWith('commentary', undefined, 'Commentary');
  });

  it('calls addPanel when Books button is clicked', async () => {
    const user = userEvent.setup();
    const addPanel = vi.fn();
    useLayoutStore.setState({ addPanel });

    renderWithProviders(<DockviewWatermark />);

    const booksButton = screen.getByRole('button', { name: /Books/i });
    await user.click(booksButton);

    expect(addPanel).toHaveBeenCalledWith('book', undefined, 'Books');
  });

  it('calls addPanel when Dictionary button is clicked', async () => {
    const user = userEvent.setup();
    const addPanel = vi.fn();
    useLayoutStore.setState({ addPanel });

    renderWithProviders(<DockviewWatermark />);

    const dictButton = screen.getByRole('button', { name: /Dictionary/i });
    await user.click(dictButton);

    expect(addPanel).toHaveBeenCalledWith('dictionary', undefined, 'Dictionary');
  });

  it('calls addPanel when Notes button is clicked', async () => {
    const user = userEvent.setup();
    const addPanel = vi.fn();
    useLayoutStore.setState({ addPanel });

    renderWithProviders(<DockviewWatermark />);

    const notesButton = screen.getByRole('button', { name: /Notes/i });
    await user.click(notesButton);

    expect(addPanel).toHaveBeenCalledWith('notes', undefined, 'Notes');
  });

  it('calls addPanel when Prayer button is clicked', async () => {
    const user = userEvent.setup();
    const addPanel = vi.fn();
    useLayoutStore.setState({ addPanel });

    renderWithProviders(<DockviewWatermark />);

    const prayerButton = screen.getByRole('button', { name: /Prayer/i });
    await user.click(prayerButton);

    expect(addPanel).toHaveBeenCalledWith('prayer', undefined, 'Prayer');
  });

  it('renders buttons with proper styling', () => {
    renderWithProviders(<DockviewWatermark />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach(button => {
      expect(button).toHaveStyle({
        cursor: 'pointer',
      });
    });
  });

  it('displays all panel labels', () => {
    renderWithProviders(<DockviewWatermark />);

    const panelLabels = ['Bible', 'Commentary', 'Books', 'Dictionary', 'Notes', 'Prayer'];
    panelLabels.forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});
