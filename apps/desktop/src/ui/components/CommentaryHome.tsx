import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useI18n } from '../contexts/useI18n';
import { CommentaryHomeModuleData, CommentaryEntry } from '../stores/useCommentaryStore';
import { useCommentaryPanel } from '../stores/hooks/useCommentaryPanel';
import { useBibleStore, DEFAULT_PANEL_ID } from '../stores/useBibleStore';
import { previewVerseInPrimary } from '../stores/crossStoreBridge';
import { formatVerseReference } from '../utils/verseReference';
import { reprocessCommentaryLinks } from '../utils/commentaryLinkProcessor';
import VersePreviewTooltip from './VersePreviewTooltip';
import DigestDisclaimer from './commentary/DigestDisclaimer';
import { useModuleProvenance } from './commentary/useModuleProvenance';
import { MODULE_PROVENANCE_TEXT, DIGEST_DISPLAY_NAME, isDigestModule } from '../moduleDescriptions';
import { sanitizeHtml } from '../utils/sanitize';
import { looksLikeMarkdown, markdownToHtml } from './study/markdown';
import { VerseIdHelper } from '@bible/core';
import { StarIcon } from './shared/icons/StarIcon';
import { ConfirmDialog } from './shared/ConfirmDialog';

interface CommentaryHomeProps {
  panelId?: string;
  currentVerseId: number | null;
  onOpenTab: (abbreviation: string, name: string) => void;
}

type SortMode = 'default' | 'az' | 'long' | 'short';

/**
 * CommentaryHome - Overview tab showing all commentaries for the current verse.
 * Separates verse-specific and passage-level commentaries like the web app.
 * Supports mute, promote, and add-to-tabs actions.
 */
const CommentaryHome: React.FC<CommentaryHomeProps> = ({ panelId, currentVerseId, onOpenTab }) => {
  const { t } = useI18n();
  const { homeData, homeLoading, openTabs, mutedModules, promotedModules, toggleMuted, togglePromoted } = useCommentaryPanel(panelId);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [filter, setFilter] = useState('');
  const [showMuted, setShowMuted] = useState(false);

  const verseRef = currentVerseId ? formatVerseReference(currentVerseId) : '';

  // Separate modules into verse-specific, passage-level, and muted
  const { verseModules, passageModules, mutedModulesList } = useMemo(() => {
    const verse: CommentaryHomeModuleData[] = [];
    const passage: CommentaryHomeModuleData[] = [];
    const muted: CommentaryHomeModuleData[] = [];

    for (const mod of homeData) {
      if (mutedModules.has(mod.abbreviation)) {
        muted.push(mod);
        continue;
      }

      const verseEntries = mod.entries.filter(e => e.entry_level === 'verse');
      const passageEntries = mod.entries.filter(e => e.entry_level !== 'verse');

      if (verseEntries.length > 0) {
        const wc = verseEntries.reduce((sum, e) => sum + (e.word_count || 0), 0);
        verse.push({ ...mod, entries: verseEntries, totalWordCount: wc });
      }
      if (passageEntries.length > 0) {
        const sorted = [...passageEntries].sort((a, b) => {
          const spanA = (a.verse_id_end ?? a.verse_id_start ?? 0) - (a.verse_id_start ?? 0);
          const spanB = (b.verse_id_end ?? b.verse_id_start ?? 0) - (b.verse_id_start ?? 0);
          return spanA - spanB;
        });
        const wc = passageEntries.reduce((sum, e) => sum + (e.word_count || 0), 0);
        passage.push({ ...mod, entries: sorted, totalWordCount: wc });
      }
    }

    return { verseModules: verse, passageModules: passage, mutedModulesList: muted };
  }, [homeData, mutedModules]);

  // Sort and filter a list of modules
  const sortAndFilter = (modules: CommentaryHomeModuleData[]) => {
    let filtered = modules;
    if (filter) {
      const lower = filter.toLowerCase();
      filtered = filtered.filter(m =>
        m.abbreviation.toLowerCase().includes(lower) ||
        m.name.toLowerCase().includes(lower)
      );
    }
    const sorted = [...filtered];
    switch (sortMode) {
      case 'az':
        sorted.sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
        break;
      case 'long':
        sorted.sort((a, b) => b.totalWordCount - a.totalWordCount);
        break;
      case 'short':
        sorted.sort((a, b) => a.totalWordCount - b.totalWordCount);
        break;
      default: {
        const openAbbrs = new Set(openTabs.map(t => t.abbreviation));
        sorted.sort((a, b) => {
          // Promoted first
          const aProm = promotedModules.has(a.abbreviation) ? 0 : 1;
          const bProm = promotedModules.has(b.abbreviation) ? 0 : 1;
          if (aProm !== bProm) return aProm - bProm;
          // Open tabs next
          const aOpen = openAbbrs.has(a.abbreviation) ? 0 : 1;
          const bOpen = openAbbrs.has(b.abbreviation) ? 0 : 1;
          if (aOpen !== bOpen) return aOpen - bOpen;
          return b.totalWordCount - a.totalWordCount;
        });
        break;
      }
    }
    return sorted;
  };

  const sortedVerse = useMemo(() => sortAndFilter(verseModules), [verseModules, filter, sortMode, openTabs, promotedModules]);
  const sortedPassage = useMemo(() => sortAndFilter(passageModules), [passageModules, filter, sortMode, openTabs, promotedModules]);
  const filteredMuted = useMemo(() => {
    if (!filter) return mutedModulesList;
    const lower = filter.toLowerCase();
    return mutedModulesList.filter(m =>
      m.abbreviation.toLowerCase().includes(lower) ||
      m.name.toLowerCase().includes(lower)
    );
  }, [mutedModulesList, filter]);

  const toggleExpand = (abbreviation: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(abbreviation)) next.delete(abbreviation);
      else next.add(abbreviation);
      return next;
    });
  };

  const isTabOpen = (abbreviation: string) =>
    openTabs.some(t => t.abbreviation === abbreviation);

  const maxWords = useMemo(() =>
    Math.max(2000, ...homeData.map(m => m.totalWordCount)),
    [homeData]
  );

  if (homeLoading && homeData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <div className="text-center">
          <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full mx-auto mb-2" />
          Loading commentaries...
        </div>
      </div>
    );
  }

  if (!currentVerseId) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        {t('commentaryHome.navigateToAVerseToSee')}
      </div>
    );
  }

  const renderModuleList = (modules: CommentaryHomeModuleData[], isMutedSection = false) => (
    <div className="divide-y divide-border">
      {modules.map(mod => (
        <CommentaryHomeModule
          key={mod.abbreviation}
          module={mod}
          expanded={expandedModules.has(mod.abbreviation)}
          onToggle={() => toggleExpand(mod.abbreviation)}
          isTabOpen={isTabOpen(mod.abbreviation)}
          onOpenTab={() => onOpenTab(mod.abbreviation, mod.name)}
          maxWords={maxWords}
          contextBookNumber={currentVerseId ? Math.floor(currentVerseId / 1000000) : undefined}
          isPromoted={promotedModules.has(mod.abbreviation)}
          isMuted={mutedModules.has(mod.abbreviation)}
          onToggleMute={() => toggleMuted(mod.abbreviation)}
          onTogglePromote={() => togglePromoted(mod.abbreviation)}
          isMutedSection={isMutedSection}
        />
      ))}
    </div>
  );

  const totalCount = verseModules.length + passageModules.length + mutedModulesList.length;
  const filteredCount = sortedVerse.length + sortedPassage.length;

  return (
    <div className="h-full overflow-auto">
      {/* Header with sort and filter - scrolls with content */}
      <div className="px-4 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-heading">
            {t('commentaryHome.heading', { reference: verseRef })}
          </h3>
          <span className="text-xs text-text-secondary">
            {t('commentaryHome.moduleCount', { filtered: filteredCount, total: totalCount })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* The box matches on module name and abbreviation, and "Filter..."
              said nothing about which of the several lists on screen it acts
              on. It also had no label of any kind, so a screen reader
              announced an unnamed text field. */}
          <input
            type="text"
            placeholder={t('commentaryHome.filterPlaceholder')}
            aria-label={t('commentaryHome.filterLabel')}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="flex-1 px-2 py-1 text-sm border border-border rounded"
            style={{ backgroundColor: 'var(--theme-bg-primary)' }}
          />
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            className="px-2 py-1 text-xs border border-border rounded cursor-pointer"
            style={{ backgroundColor: 'var(--theme-bg-primary)' }}
          >
            <option value="default">{t('commentaryHome.sortDefault')}</option>
            <option value="az">{t('commentaryHome.sortAZ')}</option>
            <option value="long">{t('commentaryHome.sortLong')}</option>
            <option value="short">{t('commentaryHome.sortShort')}</option>
          </select>
        </div>
      </div>

      {/* Module list - separated into sections */}
      <div>
        {sortedVerse.length === 0 && sortedPassage.length === 0 && filteredMuted.length === 0 ? (
          <div className="text-center text-text-secondary py-8 px-4">
            {homeData.length === 0
              ? 'No commentaries have content for this verse'
              : 'No matching commentaries'
            }
          </div>
        ) : (
          <>
            {/* Verse-specific commentaries */}
            {sortedVerse.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <div className="flex items-center gap-2 px-4 text-xs font-semibold text-text-secondary uppercase tracking-wide" style={{ marginBottom: '12px', paddingBottom: '6px', borderBottom: '1px solid var(--theme-border-primary)' }}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  {t('commentaryHome.heading', { reference: verseRef })}
                </div>
                {renderModuleList(sortedVerse)}
              </div>
            )}

            {/* Passage-level commentaries */}
            {sortedPassage.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <div className="flex items-center gap-2 px-4 text-xs font-semibold text-text-secondary uppercase tracking-wide" style={{ marginBottom: '12px', paddingBottom: '6px', borderBottom: '1px solid var(--theme-border-primary)' }}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  {t('commentaryHome.commentaryOnPassage')}
                </div>
                {renderModuleList(sortedPassage)}
              </div>
            )}

            {/* Muted commentaries */}
            {filteredMuted.length > 0 && (
              <div style={{ opacity: 0.6, marginBottom: '24px' }}>
                <div
                  className="flex items-center gap-1.5 px-4 text-xs font-semibold text-text-secondary uppercase tracking-wide cursor-pointer hover:text-text-primary select-none"
                  style={{ marginBottom: '12px', paddingBottom: '6px', borderBottom: '1px solid var(--theme-border-primary)' }}
                  onClick={() => setShowMuted(!showMuted)}
                >
                  <svg className={`w-3 h-3 transition-transform ${showMuted ? 'rotate-90' : ''} rtl-mirror`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {t('commentaryHome.muted', { v1: filteredMuted.length })}
                </div>
                {showMuted && renderModuleList(filteredMuted, true)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Single module card in the Overview tab
 */
const CommentaryHomeModule: React.FC<{
  module: CommentaryHomeModuleData;
  expanded: boolean;
  onToggle: () => void;
  isTabOpen: boolean;
  onOpenTab: () => void;
  maxWords: number;
  contextBookNumber?: number;
  isPromoted: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  onTogglePromote: () => void;
  isMutedSection?: boolean;
}> = ({ module, expanded, onToggle, isTabOpen, onOpenTab, maxWords, contextBookNumber, isPromoted, isMuted, onToggleMute, onTogglePromote, isMutedSection }) => {
  const { t } = useI18n();
  const widthPercent = Math.min(100, (module.totalWordCount / maxWords) * 100);
  // The Overview grid is where readers choose what to trust, so machine-generated
  // modules are labelled in the collapsed row too - not only once expanded.
  const provenanceKind = useModuleProvenance(module.abbreviation);
  const disclaimerId = `commentary-home-disclaimer-${module.abbreviation}`;
  // Muting hides a commentary from the list, so it asks for confirmation first;
  // unmuting (reversing that) does not.
  const [showMuteConfirm, setShowMuteConfirm] = useState(false);
  const handleMuteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMuted) {
      onToggleMute();
    } else {
      setShowMuteConfirm(true);
    }
  };

  return (
    <div>
      {/* Module header - two rows, bar right-bounded */}
      <div
        data-testid="commentary-home-module"
        className={`px-4 py-2 cursor-pointer hover:bg-background-hover transition-colors ${isPromoted ? 'border-s-3 border-s-accent ps-3' : ''}`}
        style={isPromoted ? { borderInlineStart: '3px solid var(--theme-accent-primary)', paddingInlineStart: '13px' } : undefined}
        onClick={onToggle}
      >
        {/* Row 1: chevron | abbreviation | promoted icon | bar-track (flex:1) */}
        <div className="flex items-center gap-2">
          <svg
            className={`w-3 h-3 text-text-secondary transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''} rtl-mirror`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-semibold text-sm text-accent flex-shrink-0">
            {isDigestModule(module.abbreviation) ? DIGEST_DISPLAY_NAME : module.abbreviation}
          </span>
          {provenanceKind && (
            <span
              data-testid="commentary-home-provenance-badge"
              className="flex-shrink-0 rounded bg-info-soft px-1.5 py-0.5 text-[10px] font-medium text-info-text"
            >
              {t(MODULE_PROVENANCE_TEXT[provenanceKind].collapsedKey)}
            </span>
          )}
          {isPromoted && (
            <span className="flex-shrink-0" title={t('commentaryHome.favoritedBadgeTitle')}>
              <StarIcon favorited className="w-3 h-3 text-accent" />
            </span>
          )}
          {/* Bar track fills remaining space; bar is right-aligned inside */}
          <div className="flex-1 h-1.5 min-w-0">
            <div
              className="h-full rounded"
              style={{
                width: `${Math.max(3, widthPercent)}%`,
                backgroundColor: 'var(--theme-success)',
                marginInlineStart: 'auto',
              }}
            />
          </div>
        </div>
        {/* Row 2: module name | word count (right-aligned, floated up) */}
        <div className="flex items-center ps-5 relative" style={{ marginTop: '-2px' }}>
          <span className="text-xs text-text-secondary truncate flex-1">
            {/* The digest module never shows its raw DB name ("Commentary Synthesis") - see docs/features/study-topics.md. */}
            {!isDigestModule(module.abbreviation) && module.name !== module.abbreviation ? module.name : ''}
          </span>
          <span className="text-[11px] flex-shrink-0 ms-auto whitespace-nowrap" style={{ color: 'var(--theme-text-muted, #999)', position: 'relative', top: '-5px' }}>
            {module.totalWordCount.toLocaleString()} words
          </span>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 ps-9 border-t border-border">
          {/* Inline header with actions - right-aligned, matching web app */}
          <div className="flex justify-end items-center gap-2 py-1.5">
            <div className="flex gap-1 me-auto">
              {/* Favorite button (not shown in muted section) */}
              {!isMutedSection && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTogglePromote(); }}
                  className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                    isPromoted ? 'text-accent' : 'text-text-muted hover:text-text-primary hover:bg-background-hover'
                  }`}
                  title={isPromoted ? t('commentaryHome.unfavoriteTitle') : t('commentaryHome.favoriteTitle')}
                >
                  <span className="inline-flex items-center gap-0.5">
                    <StarIcon favorited={isPromoted} className="w-3 h-3" />
                    {isPromoted ? t('commentaryHome.unfavoriteLabel') : t('commentaryHome.favoriteLabel')}
                  </span>
                </button>
              )}
              {/* Mute button - muting requires confirmation, unmuting does not */}
              <button
                onClick={handleMuteClick}
                className="text-[11px] px-1.5 py-0.5 rounded text-text-muted hover:text-text-primary hover:bg-background-hover transition-colors"
                title={isMuted ? t('commentaryHome.unmuteTitle') : t('commentaryHome.muteTitle')}
              >
                {isMuted ? t('commentaryHome.unmuteLabel') : t('commentaryHome.muteLabel')}
              </button>
              <ConfirmDialog
                open={showMuteConfirm}
                title={t('commentaryHome.muteConfirmTitle')}
                message={t('commentaryHome.muteConfirmMessage', {
                  module: isDigestModule(module.abbreviation) ? DIGEST_DISPLAY_NAME : module.abbreviation,
                })}
                confirmLabel={t('commentaryHome.muteConfirmConfirmLabel')}
                destructive
                onConfirm={() => { setShowMuteConfirm(false); onToggleMute(); }}
                onCancel={() => setShowMuteConfirm(false)}
              />
            </div>
            {/* Add to tabs button */}
            {isTabOpen ? (
              <button
                className="text-[11px] px-2 py-0.5 rounded border text-text-muted cursor-default opacity-70"
                style={{ borderColor: 'var(--theme-border-primary)' }}
                disabled
              >
                {t('commentaryHome.addedToTabs')}
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenTab(); }}
                className="text-[11px] px-2 py-0.5 rounded border border-accent text-accent hover:bg-accent/10 transition-colors"
                title={t('commentaryHome.addToTabsTitle')}
              >
                {t('commentaryHome.addToTabs')}
              </button>
            )}
          </div>
          {/* Machine-generated content notice - renders nothing for human-authored modules */}
          <DigestDisclaimer
            moduleAbbreviation={module.abbreviation}
            id={disclaimerId}
            collapsible={false}
            className="mb-2"
          />
          <div aria-describedby={provenanceKind ? disclaimerId : undefined}>
            {module.entries.map((entry, index) => (
              <HomeEntryPreview
                key={entry.entry_id || index}
                entry={entry}
                contextBookNumber={contextBookNumber}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Entry preview within the Overview tab
 */
const HomeEntryPreview: React.FC<{
  entry: CommentaryEntry;
  contextBookNumber?: number;
}> = ({ entry, contextBookNumber }) => {
  const { t } = useI18n();
  const contentRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    visible: boolean;
    verseId: number;
    endVerseId?: number;
    position: { x: number; y: number };
  }>({ visible: false, verseId: 0, position: { x: 0, y: 0 } });

  const processedContent = useMemo(() => {
    // Modules may ship Markdown rather than HTML (e.g. the bundled SYNTHESIS
    // commentary declares content_format: "markdown"). Convert before linking so
    // the preview doesn't leak raw ==== rules and bold/emphasis marks. Matches
    // CommentaryEntryView; sanitizeHtml below is still the final gate.
    const source = looksLikeMarkdown(entry.content)
      ? markdownToHtml(entry.content)
      : entry.content;
    const linked = reprocessCommentaryLinks(source, contextBookNumber);
    return linked
      .replace(/^(\s|<br\s*\/?>|<p>\s*<\/p>|&nbsp;)+/i, '')
      .replace(/(\s|<br\s*\/?>|<p>\s*<\/p>|&nbsp;)+$/i, '')
      .replace(/^<p>\s*/i, '<p>');
  }, [entry.content, contextBookNumber]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'A') {
        e.preventDefault();
        setTooltipState(prev => ({ ...prev, visible: false }));
        const href = target.getAttribute('href');
        if (href?.startsWith('#verse-')) {
          const verseIdStr = href.replace('#verse-', '').split('-')[0];
          const verseId = parseInt(verseIdStr, 10);
          if (!isNaN(verseId)) {
            if (e.ctrlKey || e.metaKey) {
              // Ctrl/Cmd+Click opens the reference as its own Bible panel,
              // leaving the passage the user is reading untouched.
              const parsed = VerseIdHelper.parse(verseId);
              const state = useBibleStore.getState(); // allow-getstate: event handler - imperative store access
              let targetPanelId = DEFAULT_PANEL_ID;
              if (!state.panels.has(DEFAULT_PANEL_ID)) {
                const firstKey = state.panels.keys().next().value;
                if (firstKey) targetPanelId = firstKey;
              }
              void state.openPassageInNewPanel(parsed.bookNumber, parsed.chapter, parsed.verse, targetPanelId);
            } else {
              // A scripture link on the Overview is a glance, like every other
              // one in the app: it marks the verse in the Bible pane and leaves
              // this pane where it is. See `stores/bible/slices/previewSlice.ts`.
              previewVerseInPrimary(verseId);
            }
          }
        }
      }
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' && target.classList.contains('scripture-link')) {
        const href = target.getAttribute('href');
        if (href?.startsWith('#verse-')) {
          const parts = href.replace('#verse-', '').split('-');
          const verseId = parseInt(parts[0], 10);
          const endVerseId = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
          if (!isNaN(verseId)) {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
            setTooltipState({ visible: true, verseId, endVerseId, position: { x: e.clientX, y: e.clientY } });
          }
        }
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' && target.classList.contains('scripture-link')) {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
          setTooltipState(prev => ({ ...prev, visible: false }));
        }, 100);
      }
    };

    element.addEventListener('click', handleClick);
    element.addEventListener('mouseover', handleMouseOver);
    element.addEventListener('mouseout', handleMouseOut);
    return () => {
      element.removeEventListener('click', handleClick);
      element.removeEventListener('mouseover', handleMouseOver);
      element.removeEventListener('mouseout', handleMouseOut);
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, [processedContent]);

  return (
    <div className="relative">
      {entry.entry_level !== 'verse' && (
        <span className="inline-block px-1 py-0.5 bg-background-tertiary text-[10px] text-text-secondary rounded mb-1">
          {entry.entry_level}
        </span>
      )}
      <div
        ref={contentRef}
        data-testid="commentary-home-module-preview"
        className="prose prose-sm max-w-none text-sm"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(processedContent) }}
      />
      {tooltipState.visible && (
        <VersePreviewTooltip
          verseId={tooltipState.verseId}
          endVerseId={tooltipState.endVerseId}
          position={tooltipState.position}
          onClose={() => setTooltipState(prev => ({ ...prev, visible: false }))}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
              hoverTimeoutRef.current = null;
            }
          }}
          onGoToVerse={() => {
            setTooltipState(prev => ({ ...prev, visible: false }));
            previewVerseInPrimary(tooltipState.verseId);
          }}
          hint={t('versePreviewTooltip.hintClickCtrlClick')}
        />
      )}
    </div>
  );
};

export default CommentaryHome;
