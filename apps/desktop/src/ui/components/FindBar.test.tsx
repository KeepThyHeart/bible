import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FindBar from './FindBar';
import { useFindStore } from '../stores/useFindStore';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

// Minimal mock services for components that use useI18n
function createMockServices(): AppServices {
  const mockI18n = {
    t: (key: string) => key, // Return key as-is for predictable assertions
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  };

  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: mockI18n as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ContextProvider services={createMockServices()}>
      {ui}
    </ContextProvider>,
  );
}

describe('FindBar', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
    useFindStore.setState({
      query: '',
      matches: [],
      currentMatchIndex: 0,
      isCaseSensitive: false,
    });
  });

  it('renders the search input', () => {
    renderWithProviders(<FindBar onClose={onClose} />);
    // The placeholder uses the i18n key directly
    expect(screen.getByPlaceholderText('ui.findBar.placeholder')).toBeInTheDocument();
  });

  it('focuses the input on mount', () => {
    renderWithProviders(<FindBar onClose={onClose} />);
    const input = screen.getByPlaceholderText('ui.findBar.placeholder');
    expect(input).toHaveFocus();
  });

  it('updates the store query on typing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindBar onClose={onClose} />);

    const input = screen.getByPlaceholderText('ui.findBar.placeholder');
    await user.type(input, 'grace');

    expect(useFindStore.getState().query).toBe('grace');
  });

  it('shows match count when there is a query with matches', () => {
    useFindStore.setState({
      query: 'love',
      matches: [
        { verseId: 43003016, wordIndex: 0 },
        { verseId: 43003017, wordIndex: 3 },
        { verseId: 62004008, wordIndex: 1 },
      ],
      currentMatchIndex: 1,
    });

    renderWithProviders(<FindBar onClose={onClose} />);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('shows empty string when there is no query', () => {
    useFindStore.setState({ query: '', matches: [] });
    renderWithProviders(<FindBar onClose={onClose} />);
    // The match count span should be empty
    const matchSpan = screen.getByText('', { selector: 'span.text-sm' });
    expect(matchSpan).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindBar onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls nextMatch on Enter', async () => {
    const user = userEvent.setup();
    useFindStore.setState({
      query: 'faith',
      matches: [
        { verseId: 1, wordIndex: 0 },
        { verseId: 2, wordIndex: 0 },
      ],
      currentMatchIndex: 0,
    });

    renderWithProviders(<FindBar onClose={onClose} />);
    await user.keyboard('{Enter}');

    expect(useFindStore.getState().currentMatchIndex).toBe(1);
  });

  it('calls previousMatch on Shift+Enter', async () => {
    const user = userEvent.setup();
    useFindStore.setState({
      query: 'faith',
      matches: [
        { verseId: 1, wordIndex: 0 },
        { verseId: 2, wordIndex: 0 },
      ],
      currentMatchIndex: 1,
    });

    renderWithProviders(<FindBar onClose={onClose} />);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(useFindStore.getState().currentMatchIndex).toBe(0);
  });

  it('toggles case sensitivity', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindBar onClose={onClose} />);

    const csButton = screen.getByText('Aa');
    expect(useFindStore.getState().isCaseSensitive).toBe(false);

    await user.click(csButton);
    expect(useFindStore.getState().isCaseSensitive).toBe(true);

    await user.click(csButton);
    expect(useFindStore.getState().isCaseSensitive).toBe(false);
  });

  it('disables navigation buttons when there are no matches', () => {
    useFindStore.setState({ query: 'xyz', matches: [] });
    renderWithProviders(<FindBar onClose={onClose} />);

    const buttons = screen.getAllByRole('button');
    // Previous and Next buttons (the ones with SVG arrows) should be disabled
    const prevButton = buttons.find(b => b.getAttribute('title') === 'ui.findBar.previousMatch');
    const nextButton = buttons.find(b => b.getAttribute('title') === 'ui.findBar.nextMatch');
    expect(prevButton).toBeDisabled();
    expect(nextButton).toBeDisabled();
  });
});
