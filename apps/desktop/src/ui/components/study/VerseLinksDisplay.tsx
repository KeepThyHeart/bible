import React, { useCallback, useState } from 'react';
import LinkButton from './LinkButton';
import MultiReferenceDialog, { ReferenceEntry, BookSectionEntry } from './MultiReferenceDialog';
import { formatDate } from '../../utils/verseFormatting';
import { useI18n } from '../../contexts/useI18n';
import { useCommentaryStore } from '../../stores/useCommentaryStore';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { DIGEST_DISPLAY_NAME, isDigestModule } from '../../moduleDescriptions';
import { activateWhenContentReady } from '../../services/paneHandoff';

/**
 * Open a commentary module in the Commentary pane, at this verse.
 *
 * Threading an `onNavigateToCommentary` prop down through the Bible pane
 * would leave it unpassed by `StudyModeView`, turning every one of the
 * Study-mode "Commentaries:" row's chips into a dead click. Instead the row
 * drives the commentary store directly: find (or create) a Commentary panel,
 * bring it to the front, point it at this verse, and open the module's tab.
 * `openCommentary` activates an already-open tab instead of duplicating it,
 * so clicking the same module twice is idempotent.
 */
async function openCommentaryModule(
  abbreviation: string,
  moduleName: string,
  verseId: number
): Promise<void> {
  const layout = useLayoutStore.getState(); // allow-getstate: event handler - imperative navigation
  const existing = layout.getPanelsByType('commentary');
  const panelId = existing[0]?.panelId ?? layout.addPanel('commentary');
  if (!panelId) return;

  const panel = layout.dockviewApi?.getPanel(panelId);

  const commentary = useCommentaryStore.getState(); // allow-getstate: event handler - imperative navigation
  // Sync first so a panel that has never seen a verse (freshly created above)
  // has `currentVerseId` set before `openCommentary` loads the new tab.
  const ready = (async () => {
    await commentary.syncWithBibleVerse(panelId, verseId);
    commentary.openCommentary(panelId, abbreviation, moduleName);
  })();

  // Activating the tab first brought the pane to the front still showing the
  // previous module and verse, which then blinked over to the new one. Hold
  // the switch until the commentary is pointed at the right place - capped, so
  // a slow module cannot make the click feel unanswered.
  if (panel) activateWhenContentReady(() => panel.api.setActive(), ready);
  await ready;
}

/**
 * Verse links data structure (matches VerseLinksService output)
 */
export interface VerseLinksSummary {
  verseId: number;
  commentaries: {
    direct: CommentaryLink[];
    mentions: CommentaryLink[];
  };
  crossReferences: {
    modules: CrossReferenceModule[];
  };
  books: BookLink[];
  userContent: {
    notes: UserNoteLink[];
    journals: JournalLink[];
  };
  /** Count of user-created cross-references originating at this verse. */
  userRefCount: number;
}

export interface CommentaryLink {
  moduleId: number;
  moduleName: string;
  abbreviation: string;
  entryId: number;
  entryLevel: 'verse' | 'passage' | 'chapter' | 'book';
  verseIdStart: number;
  verseIdEnd?: number;
  isOpen: boolean;
  count?: number;
}

export interface CrossReferenceModule {
  moduleId: number;
  moduleName: string;
  abbreviation: string;
  isOpen: boolean;
  references: Array<{
    xrefId: number;
    toVerseId: number;
    toVerseReference: string;
    relationshipType?: string;
    notes?: string;
  }>;
}

export interface BookLink {
  moduleId: number;
  moduleName: string;
  abbreviation: string;
  sections: Array<{
    sectionId: number;
    sectionTitle: string;
    context?: string;
    referenceId: number;
  }>;
}

export interface UserNoteLink {
  noteId: number;
  title?: string;
  noteType: string;
  modifiedDate: string;
  contentPreview?: string;
}

export interface JournalLink {
  entryId: number;
  entryDate: string;
  title?: string;
  contentPreview?: string;
}

export interface VerseLinksDisplayProps {
  verseId: number;
  /**
   * This verse's links, loaded once for the whole chapter by
   * `useChapterStudyData` and handed down.
   *
   * Fetching them itself, on mount, per verse, would instead mean one
   * `study:getVerseLinks` each (~31 per chapter), each fanning out in the main
   * process across every installed commentary and book module - roughly 2,300
   * SQL statements for one chapter. It would also render its own "Loading..."
   * block above a top border while it waited, so every verse in the chapter
   * would grow a rule and ~2rem of placeholder and then collapse again at its
   * own moment. `null` means "this verse has no links", not "not loaded yet" -
   * the parent withholds the verses until the load resolves.
   */
  links: VerseLinksSummary | null;
  /**
   * The Study-mode "Show Commentary Links" switch
   * (`StudyModeOptions.showCommentaryLinks`). Off hides the "Commentaries:"
   * row *and* stops it counting toward `hasLinks`, so a verse whose only
   * adornment was commentary links renders no bordered block at all rather
   * than an empty one - the same rule cross-references already follow.
   * Defaults to on for callers that do not care.
   */
  showCommentaryLinks?: boolean;
  onNavigateToCommentary?: (moduleId: number, entryId: number) => void;
  onNavigateToBook?: (moduleId: number, sectionId: number) => void;
  onNavigateToNote?: (noteId: number) => void;
  onNavigateToJournal?: (entryId: number) => void;
}

/**
 * Displays all linked items for a verse in Study Mode
 * Shows commentaries, cross-references, books, and user content
 */
const VerseLinksDisplay: React.FC<VerseLinksDisplayProps> = ({
  verseId,
  links,
  showCommentaryLinks = true,
  onNavigateToCommentary,
  onNavigateToBook,
  onNavigateToNote,
  onNavigateToJournal
}) => {
  const { t } = useI18n();
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    title: string;
    references: ReferenceEntry[];
  }>({
    isOpen: false,
    title: '',
    references: []
  });

  /**
   * Open a commentary. Callers may override the destination with
   * `onNavigateToCommentary`; with no override the row opens the module in the
   * Commentary pane itself, which is what makes these chips clickable at all
   * (see `openCommentaryModule`).
   */
  const navigateToCommentary = useCallback(
    (comm: CommentaryLink) => {
      if (onNavigateToCommentary) {
        onNavigateToCommentary(comm.moduleId, comm.entryId);
        return;
      }
      void openCommentaryModule(comm.abbreviation, comm.moduleName, verseId);
    },
    [onNavigateToCommentary, verseId]
  );

  const handleBookClick = (book: BookLink) => {
    if (book.sections.length === 1) {
      // Single section: navigate directly
      const section = book.sections[0];
      if (onNavigateToBook) {
        onNavigateToBook(book.moduleId, section.sectionId);
      }
    } else {
      // Multiple sections: show dialog
      const entries: BookSectionEntry[] = book.sections.map(section => ({
        type: 'book_section',
        moduleId: book.moduleId,
        sectionId: section.sectionId,
        sectionTitle: section.sectionTitle,
        context: section.context,
        referenceId: section.referenceId
      }));

      setDialogState({
        isOpen: true,
        title: `${book.abbreviation} references`,
        references: entries
      });
    }
  };

  const handleDialogSelect = (entry: ReferenceEntry) => {
    switch (entry.type) {
      case 'book_section':
        if (onNavigateToBook) {
          onNavigateToBook(entry.moduleId, entry.sectionId);
        }
        break;
    }
  };

  const renderJournalLinks = (journals: JournalLink[]) => {
    // Group journals by date
    const groupedByDate = journals.reduce((acc, journal) => {
      const date = journal.entryDate;
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(journal);
      return acc;
    }, {} as Record<string, JournalLink[]>);

    return Object.entries(groupedByDate).map(([date, entries]) => {
      const label = entries.length > 1
        ? `Journal: ${formatDate(date)} and ${entries.length - 1} more...`
        : `Journal: ${formatDate(date)}`;

      return (
        <LinkButton
          key={date}
          label={label}
          onClick={() => {
            if (onNavigateToJournal) {
              onNavigateToJournal(entries[0].entryId);
            }
          }}
        />
      );
    });
  };

  // No loading branch. `links === null` means "this verse has nothing", so the
  // row renders nothing rather than a placeholder that will collapse later.
  if (!links) {
    return null;
  }

  // Check if there are any links to display.
  //
  // Cross-references are deliberately absent: they render once, above, as
  // `CrossReferenceDisplay`'s inline phrase-group row. A verse whose ONLY
  // adornment is cross-references therefore renders no verse-links block at
  // all, rather than an empty bordered box.
  const commentaryLinks = showCommentaryLinks ? links.commentaries.direct : [];

  const hasLinks =
    commentaryLinks.length > 0 ||
    links.books.length > 0 ||
    links.userContent.notes.length > 0 ||
    links.userContent.journals.length > 0 ||
    links.userRefCount > 0;

  if (!hasLinks) {
    return null;
  }

  return (
    <>
      <div className="mt-3 pt-3 border-t border-border text-sm space-y-2">
        {/* Commentaries that have an entry ON this verse.
            `VerseLinksService.getCommentaryEntries` has always populated this,
            but nothing rendered it: the only commentary row on screen was the
            "mentions" one below, which answers a completely different question
            and is why Matthew Henry appeared under a cross-reference heading. */}
        {commentaryLinks.length > 0 && (
          <div
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
            data-testid="verse-links-commentaries"
          >
            <span className="font-semibold text-text-primary min-w-fit">
              {t('verseLinksDisplay.commentariesLabel')}
            </span>
            {commentaryLinks.map(comm => (
              <LinkButton
                key={comm.moduleId}
                // The digest module's database abbreviation is "SYNTHESIS",
                // which is a build detail, not a name a reader should ever be
                // shown. Everywhere else in the app it reads "Combined
                // Summary"; this chip is the most visible place it did not.
                label={isDigestModule(comm.abbreviation) ? DIGEST_DISPLAY_NAME : comm.abbreviation}
                title={isDigestModule(comm.abbreviation) ? DIGEST_DISPLAY_NAME : comm.moduleName}
                onClick={() => navigateToCommentary(comm)}
                isOpen={comm.isOpen}
              />
            ))}
          </div>
        )}

        {/* Books */}
        {links.books.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-text-primary min-w-fit">{t('verseLinksDisplay.booksLabel')}</span>
            {links.books.map(book => (
              <LinkButton
                key={book.moduleId}
                label={book.abbreviation}
                onClick={() => handleBookClick(book)}
                count={book.sections.length}
              />
            ))}
          </div>
        )}

        {/* My Content */}
        {(links.userContent.notes.length > 0 || links.userContent.journals.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-text-primary min-w-fit">{t('verseLinksDisplay.myContentLabel')}</span>
            {/* User notes */}
            {links.userContent.notes.map(note => (
              <LinkButton
                key={note.noteId}
                label={note.title || `Note (${note.noteType})`}
                onClick={() => {
                  if (onNavigateToNote) {
                    onNavigateToNote(note.noteId);
                  }
                }}
              />
            ))}
            {/* Journals */}
            {renderJournalLinks(links.userContent.journals)}
          </div>
        )}
      </div>

      {/* Multi-reference dialog */}
      <MultiReferenceDialog
        isOpen={dialogState.isOpen}
        title={dialogState.title}
        references={dialogState.references}
        onClose={() => setDialogState(prev => ({ ...prev, isOpen: false }))}
        onSelect={handleDialogSelect}
      />
    </>
  );
};

export default VerseLinksDisplay;
