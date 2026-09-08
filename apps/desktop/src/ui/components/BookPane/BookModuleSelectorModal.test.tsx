/**
 * Unit tests for the Books/Dictionaries selector modal.
 *
 * Two of the three modals in this feature already announced themselves as
 * dialogs and trapped focus; this one did neither, so Tab from the filter box
 * walked straight out into the pane behind the overlay and a screen reader was
 * never told a dialog had opened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { BookModuleSelectorModal } from './BookModuleSelectorModal';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enT } from '../../testing/enCatalog';

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

const onClose = vi.fn();

function renderModal(overrides: Partial<React.ComponentProps<typeof BookModuleSelectorModal>> = {}) {
  const props: React.ComponentProps<typeof BookModuleSelectorModal> = {
    selectorType: 'book',
    selectorSearchQuery: '',
    setSelectorSearchQuery: vi.fn(),
    availableBooks: [
      { abbreviation: 'book_pp', name: "Pilgrim's Progress", database_path: '' },
    ],
    availableDictionaries: [{ abbreviation: 'easton', name: "Easton's" }],
    bookTabs: [],
    dictTabs: [],
    loadingBooks: false,
    loadingDictionaries: false,
    onClose,
    onSelectBook: vi.fn(),
    onSelectDictionary: vi.fn(),
    ...overrides,
  };
  return render(
    <ContextProvider services={createMockServices()}>
      <BookModuleSelectorModal {...props} />
    </ContextProvider>,
  );
}

describe('BookModuleSelectorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('announces itself as a modal dialog', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Add a book');
  });

  it('lists one kind only — books and dictionaries are separate panes now', () => {
    renderModal();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText("Pilgrim's Progress")).toBeInTheDocument();
    expect(screen.queryByText("Easton's")).not.toBeInTheDocument();
  });

  it('lists dictionaries when that is the pane it was opened from', () => {
    renderModal({ selectorType: 'dictionary' });
    expect(screen.getByText("Easton's")).toBeInTheDocument();
    expect(screen.queryByText("Pilgrim's Progress")).not.toBeInTheDocument();
  });

  it('closes on Escape from inside the dialog', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  // Rows have to be real buttons: clickable <div>s are unreachable by keyboard
  // and announced as plain text, leaving the search box's Enter key as the only
  // way to pick a module.
  it('renders each module as a real button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Pilgrim's Progress/ })).toBeInTheDocument();
  });
});
