import React, { useEffect, useRef } from 'react';
import { useCommentaryStore, type CommentaryEntry, type CommentaryEntrySummary } from '../../stores/useCommentaryStore';
import { useBibleStore } from '../../stores/useBibleStore';
import { useTextSettingsStore, getFontFamilyCSS } from '../../stores/useTextSettingsStore';
import { bibleAPI } from '../../services/electronAPI';
import { loadBookNamesCache, formatVerseReference } from '../../utils/verseReference';
import { commentaryAPI } from '../../services/electronAPI';
import { DIGEST_DISPLAY_NAME, isDigestModule } from '../../moduleDescriptions';
import CommentaryPassageHeader from './CommentaryPassageHeader';
import CommentaryVersePreview from './CommentaryVersePreview';
import CommentaryPinnedBanner from './CommentaryPinnedBanner';
import CommentaryContentArea from './CommentaryContentArea';
import type { DockviewPanelApi } from 'dockview-react';

interface CommentarySinglePanelProps {
  /** Dockview panel ID for per-instance state */
  panelId?: string;
  /** Dockview panel API for updating tab title */
  dockviewPanelApi?: DockviewPanelApi;
  /** The commentary module abbreviation (e.g., "Clarke") */
  contentKey: string;
}

/**
 * Lightweight single-commentary panel.
 *
 * Displays one commentary module's entries for the current verse.
 * No tab bar, no Overview, no module selector - just the content.
 * Shares rendering components with CommentaryPane for consistency.
 */
const CommentarySinglePanel: React.FC<CommentarySinglePanelProps> = ({
  panelId: _propPanelId,
  dockviewPanelApi,
  contentKey: abbreviation,
}) => {
  void _propPanelId; // reserved for future per-instance store usage

  // Per-instance state: we store entries, loading, error, pin, currentVerseId
  // directly in this component's local state since there's only one module.
  // We only use the global store for shared data (available commentaries).
  const [entries, setEntries] = React.useState<CommentaryEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [currentVerseId, setCurrentVerseId] = React.useState<number | null>(null);
  const [pinned, setPinned] = React.useState(false);
  const [pinnedVerseId, setPinnedVerseId] = React.useState<number | null>(null);
  const [moduleName, setModuleName] = React.useState(abbreviation);
  // Task #10: entry summaries for the empty-verse fallback grid.
  const [entrySummaries, setEntrySummaries] = React.useState<CommentaryEntrySummary[]>([]);
  const summariesLoadedRef = useRef(false);

  const lastChapterSyncRef = useRef<number | null>(null);
  const textSettings = useTextSettingsStore(state => state.getSettings('commentary'));

  // Use useBibleStore directly to get the first (primary) Bible panel's data,
  // since the actual dockview panel ID differs from DEFAULT_PANEL_ID.
  const primaryBiblePanel = useBibleStore(s => {
    const first = s.panels.values().next().value;
    return first ?? null;
  });
  const versesByTab = primaryBiblePanel?.versesByTab ?? new Map();
  const bibleOpenTabs = primaryBiblePanel?.openTabs ?? [];
  const bibleActiveTabIndex = primaryBiblePanel?.activeTabIndex ?? 0;

  // The Bible pane's actual current verse, tracked independently of
  // `currentVerseId` (which freezes while pinned - see the sync effect
  // below). Drives the pinned banner so it can tell whether the Bible pane
  // has actually navigated away from the pinned verse, rather than always
  // comparing two values that are locked together while pinned.
  const activeBibleTab = bibleOpenTabs[bibleActiveTabIndex];
  const liveBibleVerseId = activeBibleTab
    ? (versesByTab.get(activeBibleTab.tabId)?.[0]?.verse_id ?? null)
    : null;

  // Load book names cache on mount
  useEffect(() => {
    loadBookNamesCache(bibleAPI);
  }, []);

  // Resolve the module name from available commentaries
  useEffect(() => {
    const { availableCommentaries } = useCommentaryStore.getState(); // allow-getstate: event handler - read latest catalog snapshot
    const mod = availableCommentaries.find(c => c.abbreviation === abbreviation);
    if (mod) {
      setModuleName(mod.name);
    }
  }, [abbreviation]);

  // Update dockview tab title when verse changes
  useEffect(() => {
    if (dockviewPanelApi && currentVerseId) {
      const ref = formatVerseReference(currentVerseId);
      const displayAbbreviation = isDigestModule(abbreviation) ? DIGEST_DISPLAY_NAME : abbreviation;
      dockviewPanelApi.setTitle(`${displayAbbreviation} - ${ref}`);
    }
  }, [dockviewPanelApi, currentVerseId, abbreviation]);

  // Load commentary for a verse
  const loadForVerse = React.useCallback(async (verseId: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await commentaryAPI.getEntriesForVerse(abbreviation, verseId);
      setEntries(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commentary');
    } finally {
      setIsLoading(false);
    }
  }, [abbreviation]);

  // Sync with Bible chapter changes
  useEffect(() => {
    if (pinned) return;

    const activeBibleTab = bibleOpenTabs[bibleActiveTabIndex];
    const currentVerses = activeBibleTab ? versesByTab.get(activeBibleTab.tabId) || [] : [];

    if (currentVerses.length > 0 && currentVerses[0].verse_id) {
      const firstVerseId = currentVerses[0].verse_id;
      if (lastChapterSyncRef.current !== firstVerseId) {
        lastChapterSyncRef.current = firstVerseId;
        setCurrentVerseId(firstVerseId);
        loadForVerse(firstVerseId);
      }
    }
  }, [versesByTab, bibleOpenTabs, bibleActiveTabIndex, pinned, loadForVerse]);

  // Task #10: lazily load entry summaries once when the empty state is reached,
  // so the empty-verse fallback grid can render.
  useEffect(() => {
    if (isLoading || entries.length > 0) return;
    if (summariesLoadedRef.current) return;
    summariesLoadedRef.current = true;
    commentaryAPI.getAllEntrySummaries(abbreviation)
      .then((res) => setEntrySummaries(res))
      .catch(() => { /* ignore - grid just won't render */ });
  }, [abbreviation, isLoading, entries.length]);

  const handleTogglePin = () => {
    if (pinned) {
      setPinned(false);
      setPinnedVerseId(null);
    } else if (currentVerseId) {
      setPinned(true);
      setPinnedVerseId(currentVerseId);
    }
  };

  const handleSyncFromPin = () => {
    const state = useBibleStore.getState(); // allow-getstate: event handler - imperative store access outside render
    const primaryPanel = state.panels.values().next().value;
    if (primaryPanel) {
      const activeBTab = primaryPanel.openTabs[primaryPanel.activeTabIndex];
      if (activeBTab) {
        const verses = primaryPanel.versesByTab.get(activeBTab.tabId) || [];
        if (verses.length > 0) {
          setPinned(false);
          setPinnedVerseId(null);
          setCurrentVerseId(verses[0].verse_id);
          loadForVerse(verses[0].verse_id);
        }
      }
    }
  };

  const handleNavigateNext = async () => {
    if (!currentVerseId) return;
    try {
      const nextVerseId = await commentaryAPI.getNextVerseWithContent(abbreviation, currentVerseId);
      if (nextVerseId) {
        setPinned(false);
        setPinnedVerseId(null);
        setCurrentVerseId(nextVerseId);
        loadForVerse(nextVerseId);
        // Also navigate Bible pane
        try { useBibleStore.getState().navigateToVerseInPrimary(nextVerseId); } catch { /* ignore */ } // allow-getstate: event handler - imperative navigation, no subscription needed
      }
    } catch (err) {
      console.error(`Error navigating to next verse for ${abbreviation}:`, err);
    }
  };

  const handleNavigatePrev = async () => {
    if (!currentVerseId) return;
    try {
      const prevVerseId = await commentaryAPI.getPreviousVerseWithContent(abbreviation, currentVerseId);
      if (prevVerseId) {
        setPinned(false);
        setPinnedVerseId(null);
        setCurrentVerseId(prevVerseId);
        loadForVerse(prevVerseId);
        try { useBibleStore.getState().navigateToVerseInPrimary(prevVerseId); } catch { /* ignore */ } // allow-getstate: event handler - imperative navigation, no subscription needed
      }
    } catch (err) {
      console.error(`Error navigating to previous verse for ${abbreviation}:`, err);
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
      {/* Pinned banner - shows once the Bible pane has actually navigated
          away from the pinned verse (see `liveBibleVerseId` above). */}
      {pinned && pinnedVerseId && liveBibleVerseId !== null && liveBibleVerseId !== pinnedVerseId && (
        <CommentaryPinnedBanner
          pinnedVerseId={pinnedVerseId}
          onSyncToCurrent={handleSyncFromPin}
        />
      )}

      {/* Passage header */}
      <CommentaryPassageHeader
        currentVerseId={currentVerseId}
        pinned={pinned}
        onTogglePin={handleTogglePin}
      />

      {/* Content area with text settings */}
      <div
        className="flex-1 overflow-auto pane-content-commentary"
        style={{
          '--pane-font-family-commentary': getFontFamilyCSS(textSettings.fontFamily),
          '--pane-font-size-commentary': `${textSettings.fontSize}px`,
          '--pane-line-height-commentary': textSettings.lineHeight
        } as React.CSSProperties}
      >
        {currentVerseId && (
          <CommentaryVersePreview
            verseId={currentVerseId}
            onNavigatePrev={handleNavigatePrev}
            onNavigateNext={handleNavigateNext}
            isLoading={isLoading}
          />
        )}

        <CommentaryContentArea
          entries={entries}
          moduleName={moduleName}
          moduleAbbreviation={abbreviation}
          currentVerseId={currentVerseId}
          isLoading={isLoading}
          error={error}
          onNavigatePrev={handleNavigatePrev}
          onNavigateNext={handleNavigateNext}
          entrySummaries={entrySummaries}
          onSelectVerse={(verseId) => {
            setPinned(false);
            setPinnedVerseId(null);
            setCurrentVerseId(verseId);
            loadForVerse(verseId);
            try { useBibleStore.getState().navigateToVerseInPrimary(verseId); } catch { /* ignore */ } // allow-getstate: event handler - imperative navigation
          }}
        />
      </div>
    </div>
  );
};

export default CommentarySinglePanel;
