import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import ModuleSelector, { ModuleItem } from '../ModuleSelector';
import { PaneOverlay } from '../shared/PaneOverlay';
import { BookModule, BookTab } from '../../stores/useBookStore';

interface DictModule {
  abbreviation: string;
  name: string;
  language_code?: string;
  version?: string;
}

interface BookModuleSelectorModalProps {
  /** The pane's kind. Books and dictionaries are segregated, so this is fixed while the dialog is open. */
  selectorType: 'book' | 'dictionary';
  /** Unused now (the embedded selector owns the filter); kept so callers need not change. */
  selectorSearchQuery?: string;
  setSelectorSearchQuery?: (q: string) => void;
  availableBooks: BookModule[];
  availableDictionaries: DictModule[];
  bookTabs: BookTab[];
  dictTabs: { abbreviation: string; name: string }[];
  loadingBooks: boolean;
  loadingDictionaries: boolean;
  onClose: () => void;
  onSelectBook: (abbreviation: string, name: string) => void;
  onSelectDictionary: (abbreviation: string, name: string) => void;
}

/**
 * Modal for selecting a module to open, with a search filter.
 *
 * The dialog lists exactly one kind - whichever the pane is. A
 * Books/Dictionaries tab header here would be the one place a reader could
 * cross from a Dictionary pane into books, and back.
 */
export const BookModuleSelectorModal: React.FC<BookModuleSelectorModalProps> = ({
  selectorType,
  availableBooks,
  availableDictionaries,
  bookTabs,
  dictTabs,
  loadingBooks,
  loadingDictionaries,
  onClose,
  onSelectBook,
  onSelectDictionary,
}) => {
  const { t } = useI18n();
  // Matches BookTreeView's dialog treatment: without the trap, Tab from the
  // filter box walked straight out into the pane behind the overlay.
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const bookModules = availableBooks.map((book): ModuleItem => ({
    id: book.abbreviation,
    name: book.name,
    abbreviation: book.abbreviation,
    languageCode: book.language_code,
    version: book.version,
    openCount: bookTabs.some(tab => tab.abbreviation === book.abbreviation) ? 1 : 0,
  }));
  const dictModules = availableDictionaries.map((dict): ModuleItem => ({
    id: dict.abbreviation,
    name: dict.name,
    abbreviation: dict.abbreviation,
    languageCode: dict.language_code,
    version: dict.version,
    openCount: dictTabs.some(tab => tab.abbreviation === dict.abbreviation) ? 1 : 0,
  }));
  const headingId = 'book-module-selector-title';

  return (
    <PaneOverlay onDismiss={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* The embedded ModuleSelector below carries the one filter box (with arrow/Enter handling). */}
        <div className="px-xl py-lg border-b border-border">
          <h2 id={headingId} className="text-2xl font-semibold text-text-heading">
            {selectorType === 'book'
              ? t('bookPane.selectorBookDialogLabel')
              : t('bookPane.selectorDictionaryDialogLabel')}
          </h2>
        </div>

        {/* Module list */}
        <ModuleSelector
          title={selectorType === 'book'
            ? t('bookPane.selectBookTitle')
            : t('bookPane.selectDictionaryTitle')}
          modules={selectorType === 'book' ? bookModules : dictModules}
          isLoading={selectorType === 'book' ? loadingBooks : loadingDictionaries}
          emptyMessage={selectorType === 'book'
            ? t('bookPane.noBooksInstalled')
            : t('bookPane.noDictionariesInstalled')
          }
          onSelect={(module) => {
            if (selectorType === 'book') {
              onSelectBook(module.abbreviation, module.name);
            } else {
              onSelectDictionary(module.abbreviation, module.name);
            }
          }}
          onClose={onClose}
          embedded
        />
      </div>
    </PaneOverlay>
  );
};
