import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ENGLISH_BOOK_NAMES, getBookName } from '@bible/core';
import { FileEntry, listDirectory } from '../../services/fileNotesAPI';
import { RecentFile } from '../../stores/useFileNotesStore';
import { BreadcrumbSegment } from './NotesBreadcrumb';
import { useI18n } from '../../contexts/useI18n';
import { anchorAtPointerX } from '../../utils/overlayPosition';
import PaneEmptyState from '../onboarding/PaneEmptyState';

interface NotesFolderBrowserProps {
  entries: FileEntry[];
  currentPath: string;
  onOpenFolder: (relativePath: string) => void;
  onOpenNote: (relativePath: string) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onOpenInExplorer: (relativePath?: string) => void;
  /** Drop-a-note-on-a-folder move. Only reaches folders listed right here. */
  onMove?: (entry: FileEntry, targetFolder: string) => void;
  /**
   * Opens the Move-to-folder dialog for one entry. Drag-and-drop can only
   * reach a folder that happens to be in the current listing, which made
   * "move this note somewhere else in the tree" a feature users could not
   * find; this is the same move, asked for by name.
   */
  onMoveTo?: (entry: FileEntry) => void;
  /** Breadcrumb segments for the current path */
  breadcrumbs?: BreadcrumbSegment[];
  /** Called when a breadcrumb is clicked */
  onBreadcrumbNavigate?: (path: string) => void;
  /** True when browsing inside the Verse Notes folder */
  isVerseNotesFolder?: boolean;
  /** Path of the Verse Notes folder (for protecting it from rename/delete) */
  verseNotesFolderPath?: string;
  /** Recent files list (shown when sideTab is 'recent') */
  recentFiles?: RecentFile[];
  /** Called to remove a recent file entry */
  onRemoveRecentFile?: (path: string) => void;
  /** Which side tab is active (controlled by parent) */
  sideTab?: 'browse' | 'recent';
  /**
   * Opens the new-note dialog. Supplied so the empty state can offer the one
   * action that fills the pane; omitted (or omitted-by-permission, as inside
   * the Verse Notes folder) the empty state explains itself without a button.
   */
  onCreateNote?: () => void;
}

const NotesFolderBrowser: React.FC<NotesFolderBrowserProps> = ({
  entries,
  currentPath,
  onOpenFolder,
  onOpenNote,
  onRename,
  onDelete,
  onOpenInExplorer,
  onMove,
  onMoveTo,
  breadcrumbs = [],
  onBreadcrumbNavigate,
  isVerseNotesFolder = false,
  verseNotesFolderPath,
  recentFiles = [],
  onRemoveRecentFile,
  sideTab = 'browse',
  onCreateNote,
}) => {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [recentFilterQuery, setRecentFilterQuery] = useState('');
  const [deepResults, setDeepResults] = useState<FileEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchAbortRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleEntryClick = useCallback((entry: FileEntry) => {
    if (entry.isDirectory) {
      onOpenFolder(entry.path);
    } else {
      onOpenNote(entry.path);
    }
  }, [onOpenFolder, onOpenNote]);

  // Check if an entry is the protected Verse Notes root
  const isProtectedEntry = (entry: FileEntry) => {
    return verseNotesFolderPath && entry.path === verseNotesFolderPath;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  /**
   * Returns relative time string (e.g. "5 days ago") if within 12 months, else
   * empty. Singular and plural are separate whole messages rather than a
   * translated fragment glued to a number, so a translator controls the shape
   * of the entire sentence.
   */
  const formatRelativeTime = (isoStr: string): string => {
    const then = new Date(isoStr).getTime();
    const now = Date.now();
    const diffMs = now - then;
    if (diffMs < 0) return '';

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    const months = Math.floor(days / 30.44);

    if (months > 12) return '';
    if (months >= 1) {
      return months === 1
        ? t('notesFolderBrowser.relativeTime.monthAgo')
        : t('notesFolderBrowser.relativeTime.monthsAgo', { count: months });
    }
    if (days >= 1) {
      return days === 1
        ? t('notesFolderBrowser.relativeTime.dayAgo')
        : t('notesFolderBrowser.relativeTime.daysAgo', { count: days });
    }
    if (hours >= 1) {
      return hours === 1
        ? t('notesFolderBrowser.relativeTime.hourAgo')
        : t('notesFolderBrowser.relativeTime.hoursAgo', { count: hours });
    }
    if (minutes >= 1) {
      return minutes === 1
        ? t('notesFolderBrowser.relativeTime.minuteAgo')
        : t('notesFolderBrowser.relativeTime.minutesAgo', { count: minutes });
    }
    return t('notesFolderBrowser.relativeTime.justNow');
  };

  // --- Filter / search logic ---

  // Book name/abbreviation resolution comes from @bible/core, which carries
  // the repo-wide alias table.

  /** Try to parse a Bible reference from the query (e.g., "John 3", "Rom 8:28") */
  const parseBibleRef = useCallback((q: string): { bookName: string; chapter?: number; verse?: number } | null => {
    const trimmed = q.trim().toLowerCase();
    // Pattern: book [chapter[:verse]]
    const m = trimmed.match(/^([123]?\s*[a-z]+(?:\s+of\s+[a-z]+)?)\s*(\d+)?(?::(\d+))?$/);
    if (!m) return null;
    const bookKey = m[1].trim();
    const bookNumber = ENGLISH_BOOK_NAMES.get(bookKey);
    if (bookNumber === undefined) return null;
    const bookName = getBookName(bookNumber);
    const chapter = m[2] ? parseInt(m[2], 10) : undefined;
    const verse = m[3] ? parseInt(m[3], 10) : undefined;
    return { bookName, chapter, verse };
  }, []);

  /** Recursively search folders below `basePath` for entries matching `query` */
  const deepSearch = useCallback(async (query: string, basePath: string, searchId: number) => {
    const lowerQuery = query.toLowerCase();
    const results: FileEntry[] = [];
    const MAX_RESULTS = 50;
    const MAX_DIRS = 100;
    let dirsScanned = 0;

    const queue: string[] = [basePath];

    while (MAX_RESULTS > results.length && MAX_DIRS > dirsScanned && queue.length > 0) {
      if (searchAbortRef.current !== searchId) return; // aborted

      const dir = queue.shift()!;
      dirsScanned++;

      try {
        const items = await listDirectory(dir);
        for (const item of items) {
          if (searchAbortRef.current !== searchId) return;
          if (item.isDirectory) {
            queue.push(item.path);
          }
          if (item.name.toLowerCase().includes(lowerQuery)) {
            results.push(item);
            if (results.length >= MAX_RESULTS) break;
          }
        }
      } catch {
        // skip inaccessible dirs
      }
    }

    // Also search verse notes if query looks like a Bible reference
    const ref = parseBibleRef(query);
    if (ref) {
      try {
        const vnBase = 'Verse Notes';
        const bookPath = `${vnBase}/${ref.bookName}`;
        if (ref.chapter) {
          const chapterPath = `${bookPath}/${ref.chapter}`;
          const chapterEntries = await listDirectory(chapterPath).catch(() => [] as FileEntry[]);
          for (const entry of chapterEntries) {
            if (searchAbortRef.current !== searchId) return;
            if (!entry.isDirectory) {
              if (ref.verse) {
                // Match specific verse in filename (e.g., "John 3_16.bn")
                if (entry.name.toLowerCase().includes(`${ref.chapter}_${ref.verse}`) ||
                    entry.name.toLowerCase().includes(`${ref.chapter}:${ref.verse}`)) {
                  if (!results.find(r => r.path === entry.path)) results.push(entry);
                }
              } else {
                // All notes in this chapter
                if (!results.find(r => r.path === entry.path)) results.push(entry);
              }
            }
          }
        } else {
          // Just book name - list chapters
          const bookEntries = await listDirectory(bookPath).catch(() => [] as FileEntry[]);
          for (const entry of bookEntries) {
            if (!results.find(r => r.path === entry.path)) results.push(entry);
          }
        }
      } catch {
        // verse notes folder may not exist
      }
    }

    if (searchAbortRef.current === searchId) {
      setDeepResults(results);
      setIsSearching(false);
    }
  }, [parseBibleRef]);

  /** Handle filter input changes with debounced deep search */
  const handleFilterChange = useCallback((query: string) => {
    setFilterQuery(query);

    // Cancel any pending search
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setDeepResults([]);
      setIsSearching(false);
      searchAbortRef.current++;
      return;
    }

    setIsSearching(true);
    const searchId = ++searchAbortRef.current;

    debounceRef.current = setTimeout(() => {
      deepSearch(query.trim(), currentPath, searchId);
    }, 300);
  }, [currentPath, deepSearch]);

  // Reset filter when currentPath changes (navigated to a different folder)
  useEffect(() => {
    setFilterQuery('');
    setDeepResults([]);
    setIsSearching(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    searchAbortRef.current++;
  }, [currentPath]);

  // Compute filtered entries: local entries filtered + deep results (deduplicated)
  const filteredEntries = filterQuery.trim()
    ? (() => {
        const lq = filterQuery.trim().toLowerCase();
        const localMatches = entries.filter(e => e.name.toLowerCase().includes(lq));
        const localPaths = new Set(localMatches.map(e => e.path));
        const deepExtra = deepResults.filter(e => !localPaths.has(e.path));
        return [...localMatches, ...deepExtra];
      })()
    : entries;

  // Build placeholder for filter input (normalize path delimiters)
  const filterPlaceholder = currentPath
    ? t('notesFolderBrowser.filterPlaceholder', { path: currentPath.replace(/\\/g, '/'), })
    : t('notesFolderBrowser.filterPlaceholderHome');

  // Drag-and-drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, entry: FileEntry) => {
    if (entry.isDirectory || isVerseNotesFolder) return;
    e.dataTransfer.setData('text/plain', entry.path);
    e.dataTransfer.effectAllowed = 'move';
  }, [isVerseNotesFolder]);

  const handleDragOver = useCallback((e: React.DragEvent, entry: FileEntry) => {
    if (!entry.isDirectory) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolder(entry.path);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverFolder(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetFolder: FileEntry) => {
    e.preventDefault();
    setDragOverFolder(null);
    if (!targetFolder.isDirectory || !onMove) return;
    const sourcePath = e.dataTransfer.getData('text/plain');
    if (!sourcePath) return;
    const sourceEntry = entries.find(en => en.path === sourcePath);
    if (sourceEntry) {
      onMove(sourceEntry, targetFolder.path);
    }
  }, [entries, onMove]);

  // Render a file/folder entry row
  const renderEntry = (entry: FileEntry) => (
    <button
      key={entry.path}
      type="button"
      onClick={() => handleEntryClick(entry)}
      onContextMenu={(e) => handleContextMenu(e, entry)}
      draggable={!entry.isDirectory && !isVerseNotesFolder}
      onDragStart={(e) => handleDragStart(e, entry)}
      onDragOver={(e) => handleDragOver(e, entry)}
      onDragLeave={handleDragLeave}
      onDrop={(e) => handleDrop(e, entry)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-background-hover transition-colors text-start ${
        dragOverFolder === entry.path ? 'bg-accent-light ring-2 ring-accent ring-inset' : ''
      }`}
    >
      {entry.isDirectory ? (
        <div className="relative w-5 h-5 flex-shrink-0">
          <svg className="w-5 h-5 text-warning" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
          </svg>
          {isProtectedEntry(entry) && (
            <svg className="w-2.5 h-2.5 text-text-secondary absolute -bottom-0.5 -end-0.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      ) : (
        <svg className="w-5 h-5 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-heading truncate">{entry.name}</div>
      </div>
      {/* The lock badge above is decorative; state it in words for non-sighted users. */}
      {entry.isDirectory && isProtectedEntry(entry) && (
        <span className="sr-only">
          {t('notesFolderBrowser.protectedFolder')}
        </span>
      )}
      <div className="text-xs text-text-secondary flex-shrink-0">{formatDate(entry.modified)}</div>
      {entry.isDirectory && (
        <svg className="w-4 h-4 text-text-muted flex-shrink-0 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );

  return (
    <div className="flex flex-col h-full" onClick={closeContextMenu}>
      <div className="flex-1 flex flex-col min-w-0">
        {/* Breadcrumb bar (inside content area, OneDrive-style) */}
        {sideTab === 'browse' && breadcrumbs.length > 0 && (
          <nav
            className="flex items-center gap-1 px-4 py-2 text-sm border-b border-border bg-surface overflow-x-auto whitespace-nowrap flex-shrink-0"
            aria-label={t('notesFolderBrowser.breadcrumbLabel')}
          >
            {breadcrumbs.map((seg, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <React.Fragment key={seg.path}>
                  {i > 0 && (
                    <svg className="w-3 h-3 text-text-secondary flex-shrink-0 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                  {isLast ? (
                    <span className="font-medium text-text-heading" aria-current="true">{seg.label}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBreadcrumbNavigate?.(seg.path)}
                      className="text-accent-strong hover:text-accent-strong hover:underline transition-colors"
                    >
                      {seg.label}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </nav>
        )}

        {/* Filter input */}
        {sideTab === 'browse' && (
          <div className="px-3 py-2 border-b border-border bg-surface flex-shrink-0">
            <div className="relative">
              <svg className="w-4 h-4 text-text-muted absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                id="notes-folder-filter"
                type="text"
                value={filterQuery}
                onChange={(e) => handleFilterChange(e.target.value)}
                placeholder={filterPlaceholder}
                aria-label={filterPlaceholder}
                className="w-full ps-8 pe-8 py-1.5 text-sm border border-border rounded-md bg-surface-secondary focus:bg-surface focus:border-accent focus:outline-none transition-colors placeholder:text-text-muted"
              />
              {filterQuery && (
                <button
                  type="button"
                  onClick={() => handleFilterChange('')}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
                  aria-label={t('notesFolderBrowser.clearFilter')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Browse view */}
        {sideTab === 'browse' && (
          <div className="flex-1 overflow-auto">
            {filteredEntries.length === 0 ? (
              filterQuery.trim() ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    {isSearching ? (
                      <p className="text-sm text-text-secondary">{t('notesFolderBrowser.searching')}</p>
                    ) : (
                      <>
                        <svg className="w-12 h-12 mx-auto mb-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <p className="text-sm text-text-secondary mb-1">{t('notesFolderBrowser.noMatchingNotes')}</p>
                        <p className="text-xs text-text-secondary">{t('notesFolderBrowser.tryDifferentSearch')}</p>
                      </>
                    )}
                  </div>
                </div>
              ) : isVerseNotesFolder ? (
                    // Verse Notes is filled by annotating verses, never by a
                    // "New note" button - so it gets an explanation and no
                    // action rather than an action that would be wrong here.
                    <PaneEmptyState
                      icon="✍️"
                      testId="verse-notes-empty-state"
                      title={t('onboarding.empty.verseNotes.title')}
                      description={t('onboarding.empty.verseNotes.description')}
                    />
                  ) : (
                    <PaneEmptyState
                      icon="📝"
                      testId="notes-empty-state"
                      title={t('onboarding.empty.notes.title')}
                      description={t('onboarding.empty.notes.description')}
                      actions={
                        onCreateNote
                          ? [
                              {
                                label: t('onboarding.empty.notes.action'),
                                onClick: onCreateNote,
                                primary: true,
                                testId: 'notes-empty-create',
                              },
                            ]
                          : undefined
                      }
                    />
                  )
            ) : (
              <div className="divide-y divide-border">
                {filteredEntries.map((entry) => (
                  <React.Fragment key={entry.path}>
                    {renderEntry(entry)}
                    {/* Show relative path for deep search results not in current entries */}
                    {filterQuery.trim() && !entries.find(e => e.path === entry.path) && (
                      <div className="px-4 pb-1 -mt-1.5 text-xs text-text-secondary truncate ps-12">
                        {entry.path}
                      </div>
                    )}
                  </React.Fragment>
                ))}
                {isSearching && (
                  <div className="px-4 py-2 text-xs text-text-secondary text-center">{t('notesFolderBrowser.searchingSubfolders')}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Recent view */}
        {sideTab === 'recent' && (
          <div className="flex-1 overflow-auto flex flex-col">
            {/* Recent files filter */}
            {recentFiles.length > 0 && (
              <div className="px-3 py-2 border-b border-border flex-shrink-0">
                <input
                  id="notes-recent-filter"
                  type="text"
                  placeholder={t('notesFolderBrowser.filterRecentPlaceholder')}
                  aria-label={t('notesFolderBrowser.filterRecentPlaceholder')}
                  className="w-full text-sm px-2.5 py-1.5 border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent focus:border-transparent"
                  value={recentFilterQuery}
                  onChange={(e) => setRecentFilterQuery(e.target.value)}
                />
              </div>
            )}
            {recentFiles.length === 0 ? (
              <div className="flex items-center justify-center flex-1">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-text-secondary">{t('notesFolderBrowser.noRecentFiles')}</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border overflow-auto flex-1">
                {recentFiles
                  .filter((rf) => {
                    if (!recentFilterQuery.trim()) return true;
                    const q = recentFilterQuery.toLowerCase();
                    return rf.title.toLowerCase().includes(q) || rf.path.toLowerCase().includes(q);
                  })
                  .map((rf) => (
                  <div
                    key={rf.path}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-background-hover transition-colors group"
                  >
                    <svg className="w-5 h-5 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <button
                      type="button"
                      onClick={() => onOpenNote(rf.path)}
                      className="flex-1 min-w-0 text-start"
                    >
                      <div className="text-sm font-medium text-text-heading truncate">{rf.title}</div>
                      <div className="text-xs text-text-secondary truncate">
                        {rf.openedAt && formatRelativeTime(rf.openedAt)
                          ? <><span>{formatRelativeTime(rf.openedAt)}</span><span className="mx-1">{'\u00B7'}</span></>
                          : null}
                        {rf.path.replace(/\\/g, '/')}
                      </div>
                    </button>
                    {onRemoveRecentFile && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemoveRecentFile(rf.path); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-danger transition-all"
                        title={t('notesFolderBrowser.removeFromRecentTitle')}
                        aria-label={t('notesFolderBrowser.removeFromRecentTitle')}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-surface-elevated border border-border rounded shadow-lg py-1 min-w-[160px]"
          style={{ ...anchorAtPointerX(contextMenu.x), top: contextMenu.y }}
          onClick={closeContextMenu}
          role="menu"
          aria-label={t('notesFolderBrowser.contextMenuLabel', { name: contextMenu.entry.name, })}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleEntryClick(contextMenu.entry)}
            className="w-full px-4 py-1.5 text-sm text-start hover:bg-background-hover"
          >
            {t('notesFolderBrowser.menuOpen')}
          </button>
          {!isProtectedEntry(contextMenu.entry) && !isVerseNotesFolder && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => onRename(contextMenu.entry)}
                className="w-full px-4 py-1.5 text-sm text-start hover:bg-background-hover"
              >
                {t('notesFolderBrowser.menuRename')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onDelete(contextMenu.entry)}
                className="w-full px-4 py-1.5 text-sm text-start hover:bg-background-hover"
              >
                {t('notesFolderBrowser.menuDelete')}
              </button>
            </>
          )}
          {isVerseNotesFolder && !contextMenu.entry.isDirectory && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onDelete(contextMenu.entry)}
              className="w-full px-4 py-1.5 text-sm text-start hover:bg-background-hover"
            >
              {t('notesFolderBrowser.menuDelete')}
            </button>
          )}
          {/* "Move to..." is the discoverable half of a feature that already
              existed: dragging a note onto a folder works, but only for a
              folder that happens to be in the current listing, and nothing on
              screen said so. Files only, matching what is draggable - moving a
              folder into its own subtree is a foot-gun this dialog has no way
              to refuse. */}
          {onMoveTo && !contextMenu.entry.isDirectory && !isVerseNotesFolder && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onMoveTo(contextMenu.entry)}
              aria-haspopup="dialog"
              className="w-full px-4 py-1.5 text-sm text-start hover:bg-background-hover"
            >
              {t('userNotesPane.moveToLabel')}
            </button>
          )}
          <div className="border-t border-border my-1" />
          <button
            type="button"
            role="menuitem"
            onClick={() => onOpenInExplorer(contextMenu.entry.path)}
            className="w-full px-4 py-1.5 text-sm text-start hover:bg-background-hover"
          >
            {t('notesFolderBrowser.menuReveal')}
          </button>
        </div>
      )}
    </div>
  );
};

export default NotesFolderBrowser;
