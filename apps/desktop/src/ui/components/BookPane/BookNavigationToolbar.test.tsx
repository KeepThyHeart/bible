/**
 * Unit tests for the Books pane navigation toolbar.
 *
 * The arrows must disable at the ends of a book, not only while loading: an
 * enabled arrow that does nothing is indistinguishable from a hang. The
 * equivalent control in BookSinglePanel disables correctly, so getting this
 * wrong makes the behaviour depend on which flavour of book panel you are in.
 */
import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { BookNavigationToolbar } from './BookNavigationToolbar';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import type { BookSection } from '../../stores/useBookStore';
import { enString, enT } from '../../testing/enCatalog';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

const CURRENT: BookSection = { section_id: 2, title: 'The Slough of Despond', content: '' };
function renderToolbar(overrides: Partial<React.ComponentProps<typeof BookNavigationToolbar>> = {}) {
  const props: React.ComponentProps<typeof BookNavigationToolbar> = {
    isLoading: false,
    currentSection: CURRENT,
    nextSectionInfo: { section_id: 3, title: 'Vanity Fair' },
    prevSectionInfo: { section_id: 1, title: 'Preface' },
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onUp: vi.fn(),
    ...overrides,
  };
  render(<ContextProvider services={createMockServices()}>{<BookNavigationToolbar {...props} />}</ContextProvider>);
  return props;
}

/** The arrows are icon-only, so they are identified by their test id. */
function prevButton() {
  return screen.getByTestId('book-prev-section');
}
function nextButton() {
  return screen.getByTestId('book-next-section');
}

describe('BookNavigationToolbar', () => {
  it('enables both arrows in the middle of a book', () => {
    renderToolbar();
    expect(prevButton()).toBeEnabled();
    expect(nextButton()).toBeEnabled();
  });

  it('disables the next arrow at the end of the book', () => {
    renderToolbar({ nextSectionInfo: null });
    expect(nextButton()).toBeDisabled();
  });

  it('disables the previous arrow at the start of the book', () => {
    renderToolbar({ prevSectionInfo: null });
    expect(prevButton()).toBeDisabled();
  });

  it('names the destination in each arrow tooltip', () => {
    renderToolbar();
    expect(prevButton()).toHaveAttribute('title', 'Previous: Preface');
    expect(nextButton()).toHaveAttribute('title', 'Next: Vanity Fair');
  });

  it('falls back to a generic tooltip when there is nowhere to go', () => {
    renderToolbar({ nextSectionInfo: null });
    expect(nextButton()).toHaveAttribute('title', enString('bookPane.nextSectionTitle'));
  });

  it('still disables both arrows while a section is loading', () => {
    renderToolbar({ isLoading: true });
    expect(prevButton()).toBeDisabled();
    expect(nextButton()).toBeDisabled();
  });

  it('offers text settings, and no Contents button — the Home tab is the contents now', () => {
    renderToolbar();
    expect(screen.getByTestId('passage-settings')).toBeInTheDocument();
    // The Contents *button* is gone. "Contents" survives only as the Up
    // control's tooltip - a label on an icon, not a second door on the toolbar,
    // so there is no visible text by that name.
    expect(screen.queryByText('Contents')).not.toBeInTheDocument();
  });

  // From any top-level section, the first included, Up goes to the book's Home
  // page rather than being hidden.
  it('always offers Up, naming the parent section or Home', () => {
    renderToolbar();
    expect(screen.getByTestId('book-up-section')).toHaveAttribute('title', 'Home');

    cleanup();
    renderToolbar({
      currentSection: { section_id: 3, title: 'Vanity Fair', content: '', parent_section_id: 2 },
    });
    expect(screen.getByTestId('book-up-section')).toHaveAttribute('title', 'Parent section');
  });

  it('wears the shared pane toolbar, so it matches the Bible pane', () => {
    renderToolbar();
    expect(screen.getByTestId('book-toolbar')).toHaveAttribute('role', 'toolbar');
  });
});
