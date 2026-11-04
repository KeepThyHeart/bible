import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChapterEndLinks from './ChapterEndLinks';
import { render } from '@testing-library/react';
import type React from 'react';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enT } from '../../testing/enCatalog';

function renderWithProviders(ui: React.ReactElement) {
  const services = {
    registry: {}, whenContext: {}, keybindings: {},
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    },
  } as unknown as AppServices;
  return render(<ContextProvider services={services}>{ui}</ContextProvider>);
}

describe('ChapterEndLinks', () => {
  it('shows both neighbours and calls the handlers (button = keyboard reachable)', async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    renderWithProviders(<ChapterEndLinks book={1} chapter={2} onPrevious={onPrevious} onNext={onNext} />);
    expect(screen.getByTestId('chapter-end-prev')).toHaveTextContent('Genesis 1');
    expect(screen.getByTestId('chapter-end-next')).toHaveTextContent('Genesis 3');
    screen.getByTestId('chapter-end-next').focus();
    await user.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('chapter-end-prev'));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('crosses book boundaries in the labels', () => {
    renderWithProviders(<ChapterEndLinks book={2} chapter={1} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByTestId('chapter-end-prev')).toHaveTextContent('Genesis 50');
  });

  it('hides the previous link at Genesis 1 and the next link at Revelation 22', () => {
    const { unmount } = renderWithProviders(<ChapterEndLinks book={1} chapter={1} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(screen.queryByTestId('chapter-end-prev')).not.toBeInTheDocument();
    expect(screen.getByTestId('chapter-end-next')).toBeInTheDocument();
    unmount();
    renderWithProviders(<ChapterEndLinks book={66} chapter={22} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(screen.queryByTestId('chapter-end-next')).not.toBeInTheDocument();
    expect(screen.getByTestId('chapter-end-prev')).toHaveTextContent('Revelation 21');
  });
});
