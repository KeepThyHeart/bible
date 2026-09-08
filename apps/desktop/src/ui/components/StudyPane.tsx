import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useI18n } from '../contexts/useI18n';
import { useStudyStore } from '../stores/useStudyStore';
import { useStudyPanel } from '../stores/hooks/useStudyPanel';
import { useTopicsStore } from '../stores/useTopicsStore';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useBibleStore } from '../stores/useBibleStore';
import { previewVerseInPrimary } from '../stores/crossStoreBridge';
import PaneNavHeader from './shared/PaneNavHeader';
import SuggestionBanner from './shared/SuggestionBanner';
import TopicSearchBar from './shared/TopicSearchBar';
import VerseTopicsList, { type VerseTopic } from './shared/VerseTopicsList';
import VersePreviewTooltip from './VersePreviewTooltip';
import DigestDisclaimer from './commentary/DigestDisclaimer';
import { useModuleProvenance } from './commentary/useModuleProvenance';
import StudySection from './study/StudySection';
import StudyRichText from './study/StudyRichText';
import { markdownToPlainText, looksLikeMarkdown } from './study/markdown';
import { crossReferenceModuleLabel } from '../utils/moduleNaming';
import { MODULE_PROVENANCE_TEXT, isDigestModule } from '../moduleDescriptions';
import { bibleAPI } from '../services/electronAPI';
import { unwrap } from '../services/ipcResult';
import { loadBookNamesCache, formatVerseReference } from '../utils/verseReference';
import { ReferenceRun } from './study/CrossReferenceDisplay';
import { targetVerseIdsFromGroup } from './study/useChapterStudyData';
import type { XrefGroupWithEntries as SharedXrefGroupWithEntries } from '../services/studyOverviewProvider';
import { tskPhraseAside, tskPhraseKeyword } from '../utils/tskPhrase';
import { DEFAULT_PANEL_ID } from '../stores/helpers/panelStateHelpers';
import { activateWhenContentReady } from '../services/paneHandoff';
import { prefetchTopic } from '../services/topicalContentCache';
import { VERSE_PAGE_SIZE } from './TopicsPane/types';
import type { IDockviewPanel } from 'dockview-react';

/**
 * Turn a literal chrome-text pixel size into a CSS `calc()` expression that
 * still resolves to exactly that literal at default settings, but scales
 * with the Typography section's "UI text" slider and the General section's
 * "Global Font Scale" slider.
 *
 * This pane's prose (cross-reference/commentary text) already flows through
 * `.pane-content-commentary` in globals.css and responds to the Study text
 * size preference. Everything else here - topic rows, section labels,
 * badges, buttons, empty-state hints - was hardcoded in px and ignored every
 * font preference. Rather than have it inherit a single font-size (which
 * would flatten the intentional hierarchy: a 10px source label should stay
 * visibly smaller than a 16px pane title), each literal is scaled by the
 * same ratio, so the hierarchy is preserved at any slider position.
 *
 * `--ui-font-scale` (set by usePreferencesStore.ts's applyTypographyToDOM)
 * is `typography.uiFontSize / DEFAULT_TYPOGRAPHY.uiFontSize` - 1 at the
 * default "UI text" size, mirroring the web app's own `--ui-font-scale`
 * (apps/web/src/stores/settingsStore.ts + _study-pane.scss's
 * `calc(Npx * var(--ui-font-scale, 1))` pattern, used throughout that file).
 * `--global-font-scale` is desktop-only and already multiplies every other
 * pane's content (see the `.pane-content-*` rules in globals.css) - chaining
 * it in here keeps this pane's chrome consistent with the rest of the app's
 * "make everything bigger" slider instead of only responding to one of the
 * two font sliders.
 */
function uiScaled(px: number): string {
  return `calc(${px}px * var(--ui-font-scale, 1) * var(--global-font-scale, 1))`;
}

interface StudyPaneProps {
  /**
   * Optional so the pane can be mounted by a detached window, which renders
   * straight from `COMPONENT_MAP` and has no dockview panel to take an id from.
   * Matches the Bible/Commentary/Book panes.
   */
  panelId?: string;
  /**
   * The verse this pane was showing when it was popped out.
   *
   * A detached window has no Bible pane, so `bibleAnchorVerseId` is always null
   * there and the pane opened on its "pick a verse" empty state. The verse
   * travels in the pop-out payload instead (see `DockviewTabRenderer`).
   */
  initialVerseId?: number | null;
}

/** Topic result from the IPC layer */
/**
 * A topic the current verse belongs to. The shape is owned by
 * `shared/VerseTopicsList`, which is what renders it here and in the Topics
 * pane, keeping the two in agreement about whether `ancestors` matters.
 */
type TopicResult = VerseTopic;

/** One commentary entry that covers the current verse */
interface CommentarySummary {
  abbreviation: string;
  /** Display name - the digest module is renamed, see `displayNameFor`. */
  name: string;
  entry_id: number;
  word_count: number;
  preview: string;
  entry_level: string;
  /**
   * Full text, kept only for modules rendered inline (the digest). Everything
   * else is fetched again on demand so the pane does not hold a verse's worth
   * of every installed commentary in memory.
   */
  content: string;
}

/**
 * Cross-reference group with entries.
 *
 * Shared with Study mode rather than redeclared: the local copy claimed
 * `phrase: string | null`, but `CrossReferenceRepository` maps a NULL phrase
 * to `undefined`, so the type was lying about the one field the whole-verse
 * grouping turns on.
 */
type XrefGroupWithEntries = SharedXrefGroupWithEntries;

/**
 * The verse a freshly opened Study pane should adopt: whatever the Bible pane
 * is anchored on. Prefers the selected verse, falling back to the first verse
 * of the chapter on screen, mirroring `navigateToVerseInPrimary`'s choice of
 * "the" Bible panel.
 *
 * Returns a plain number so the selector is referentially stable and cannot
 * loop a subscribed component.
 */
function selectBibleAnchorVerseId(state: {
  panels: Map<string, { selectedVerseId: number | null; currentBook: number; currentChapter: number }>;
}): number | null {
  const panel = state.panels.get(DEFAULT_PANEL_ID) ?? state.panels.values().next().value;
  if (!panel) return null;
  if (panel.selectedVerseId) return panel.selectedVerseId;
  if (panel.currentBook > 0 && panel.currentChapter > 0) {
    return panel.currentBook * 1000000 + panel.currentChapter * 1000 + 1;
  }
  return null;
}

/**
 * Study Pane - verse-centric hub showing cross-references, topics, the
 * auto-generated combined summary, and the rest of the installed commentaries.
 *
 * Section order and headings follow the web app's Study pane
 * (`apps/web/src/components/StudyPane/StudyPane.tsx`).
 */
const StudyPane: React.FC<StudyPaneProps> = ({ panelId: propPanelId, initialVerseId }) => {
  const panelId = propPanelId ?? DEFAULT_PANEL_ID;
  const { t } = useI18n();
  const {
    currentVerseId,
    pinned,
    suggestionVerseId,
    canGoBack,
    canGoForward,
    currentNavEntry,
    sectionsCollapsed,
    clearVerse,
    navigateToVerse,
    seedInitialVerse,
    dismissSuggestion,
    acceptSuggestion,
    goBack,
    goForward,
    togglePin,
    openCommentaryDetail,
    toggleSection,
  } = useStudyPanel(panelId);

  // Local data state
  const [topics, setTopics] = useState<TopicResult[]>([]);
  const [commentaries, setCommentaries] = useState<CommentarySummary[]>([]);
  const [xrefGroups, setXrefGroups] = useState<XrefGroupWithEntries[]>([]);
  const [xrefSources, setXrefSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * Names of the sections whose load failed, surfaced to the user instead of
   * being swallowed: a bare `catch {}` or the shared catch would otherwise
   * absorb the failure silently and report nothing on screen.
   */
  const [failedSections, setFailedSections] = useState<string[]>([]);

  const bibleAnchorVerseId = useBibleStore(selectBibleAnchorVerseId);

  const displayNameFor = useCallback(
    (abbreviation: string, moduleName: string) =>
      isDigestModule(abbreviation)
        ? t('studyPane.combinedSummaryTitle')
        : moduleName,
    [t]
  );

  // Init/destroy panel and load book names
  useEffect(() => {
    useStudyStore.getState().initPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    loadBookNamesCache(bibleAPI);
    return () => { useStudyStore.getState().destroyPanel(panelId); }; // allow-getstate: mount/unmount effect - store API for panel lifecycle
  }, [panelId]);

  /**
   * Fresh open: show something. `seedInitialVerse` restores the verse this
   * panel was last on and only falls back to the Bible pane's anchor, so this
   * is safe to re-run as the Bible pane finishes loading - a panel that already
   * has a verse is left alone.
   *
   * A handed-over verse skips that restore. Every detached window mounts under
   * the same `_default` panel id, so the remembered verse there belongs to the
   * *previous* pop-out - and it would win over the verse the reader was
   * plainly looking at when they popped this one out.
   */
  useEffect(() => {
    if (initialVerseId) {
      // allow-getstate: mount effect - seed once, without re-subscribing
      if (useStudyStore.getState().getPanelState(panelId).currentVerseId === null) {
        navigateToVerse(initialVerseId);
      }
      return;
    }
    seedInitialVerse(bibleAnchorVerseId);
  }, [panelId, navigateToVerse, seedInitialVerse, initialVerseId, bibleAnchorVerseId]);

  // Load data when verse changes.
  //
  // The three sections load INDEPENDENTLY. Sharing one `try`, in verse order
  // topics -> commentaries -> cross-references, would let a throw from
  // `topical.getTopicsForVerse` (a missing or corrupt topical module is enough)
  // abort the whole block before cross-references were ever requested, so a
  // fault in one section would blank the two below it - and an inner
  // `catch {}` around the cross-reference load would discard its error
  // entirely, leaving "no cross-references" indistinguishable from "the
  // lookup failed".
  useEffect(() => {
    if (!currentVerseId) return;
    const verseId = currentVerseId;
    let cancelled = false;
    setLoading(true);
    setFailedSections([]);

    // Section is identified by its own title key, so the banner names the
    // section the way the section header does, in the user's language.
    const noteFailure = (section: string, error: unknown) => {
      console.error(`[StudyPane] Failed to load ${section} for verse ${verseId}:`, error);
      if (!cancelled) setFailedSections(prev => (prev.includes(section) ? prev : [...prev, section]));
    };

    const loadTopics = async () => {
      try {
        const topicResults = await unwrap(window.electron.topical.getTopicsForVerse(verseId));
        if (!cancelled) setTopics(topicResults);
      } catch (error) {
        if (!cancelled) setTopics([]);
        noteFailure('studyPane.topicsTitle', error);
      }
    };

    const loadCommentaries = async () => {
      try {
        const availCommentaries = await unwrap(window.electron.commentary.getAvailableCommentaries());
        const summaries: CommentarySummary[] = [];
        for (const comm of availCommentaries) {
          const inlineRendered = isDigestModule(comm.abbreviation);
          try {
            const entries = await unwrap(window.electron.commentary.getEntriesForVerse(comm.abbreviation, verseId));
            for (const entry of entries) {
              const raw = entry.content ?? '';
              const text = looksLikeMarkdown(raw)
                ? markdownToPlainText(raw)
                : raw.replace(/<[^>]*>/g, '');
              summaries.push({
                abbreviation: comm.abbreviation,
                name: displayNameFor(comm.abbreviation, comm.name),
                entry_id: entry.entry_id,
                word_count: text.split(/\s+/).filter(Boolean).length,
                preview: text.substring(0, 150) + (text.length > 150 ? '...' : ''),
                entry_level: entry.entry_level,
                content: inlineRendered ? raw : '',
              });
            }
          } catch { /* this module simply has no entry covering this verse */ }
        }
        if (!cancelled) setCommentaries(summaries);
      } catch (error) {
        if (!cancelled) setCommentaries([]);
        noteFailure('studyPane.commentariesTitle', error);
      }
    };

    const loadCrossReferences = async () => {
      try {
        const xrefModules = await unwrap(window.electron.crossReference.getAvailable());
        const allGroups: XrefGroupWithEntries[] = [];
        const sources: string[] = [];
        for (const mod of xrefModules) {
          const groups = await unwrap(window.electron.crossReference.getGroupsForVerse(mod.abbreviation, verseId));
          // `mod.abbreviation` is the registry key (`TSKxref`), not a name the
          // user recognises - see crossReferenceModuleLabel.
          if (groups.length > 0) sources.push(mod.name ?? crossReferenceModuleLabel(mod.abbreviation));
          allGroups.push(...groups);
        }
        if (!cancelled) {
          setXrefGroups(allGroups);
          setXrefSources(sources);
        }
      } catch (error) {
        if (!cancelled) {
          setXrefGroups([]);
          setXrefSources([]);
        }
        noteFailure('studyPane.crossReferencesTitle', error);
      }
    };

    // allSettled, not all: each loader already handles its own failure, and the
    // spinner must clear once every section has settled either way.
    Promise.allSettled([loadTopics(), loadCommentaries(), loadCrossReferences()])
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [currentVerseId, displayNameFor]);

  // Navigate topic to Topics Pane
  const handleTopicClick = useCallback((abbreviation: string, topicId: number) => {
    // Find or create a Topics Pane and navigate to the topic
    const api = useLayoutStore.getState().dockviewApi; // allow-getstate: event handler - dockview API access outside render
    if (!api) return;

    // Find existing topics panel
    const panels = api.panels;
    let targetPanel: IDockviewPanel | null = null;
    for (const panel of panels) {
      if (panel.params?.contentType === 'topics') {
        targetPanel = panel;
        break;
      }
    }

    if (targetPanel) {
      // Order matters. Activating the tab first would mount the Topics pane
      // still pointed at the topic before this one, so the reader would see
      // the old topic flash past. Point it at the new topic, warm the
      // content, and only then switch - capped, so a slow query cannot make
      // the click feel dead.
      const panel = targetPanel;
      useTopicsStore.getState().navigateToTopic(panel.id, topicId, abbreviation); // allow-getstate: event handler - imperative navigation
      activateWhenContentReady(
        () => panel.api.setActive(),
        prefetchTopic(abbreviation, topicId, VERSE_PAGE_SIZE),
      );
    } else {
      // A pane created here arrives active and empty, so there is no stale
      // frame to hide - but warming the topic still spares it the round trip
      // once the navigation below lands.
      void prefetchTopic(abbreviation, topicId, VERSE_PAGE_SIZE).catch(() => {});
      // Create a new Topics Pane
      const newPanel = api.addPanel({
        id: `topics-${Date.now()}`,
        component: 'panelContent',
        title: t('paneName.topics'),
        params: { contentType: 'topics' },
      });
      // Navigate after panel is created
      setTimeout(() => {
        useTopicsStore.getState().navigateToTopic(newPanel.id, topicId, abbreviation); // allow-getstate: event handler - imperative navigation
      }, 100);
    }
  }, [t]);

  // Handle topic search selection (also opens Topics Pane)
  const handleSearchSelectTopic = useCallback((abbreviation: string, topicId: number) => {
    handleTopicClick(abbreviation, topicId);
  }, [handleTopicClick]);

  // Format verse reference
  const verseLabel = currentVerseId ? formatVerseReference(currentVerseId) : '';

  // Is currently showing commentary detail?
  const isCommentaryDetail = currentNavEntry?.type === 'commentary-detail';

  // The digest is rendered inline as its own section; the rest stay in the list.
  const digestEntries = useMemo(
    () => commentaries.filter(c => isDigestModule(c.abbreviation)),
    [commentaries]
  );
  const otherCommentaries = useMemo(
    () => commentaries.filter(c => !isDigestModule(c.abbreviation)),
    [commentaries]
  );

  // Empty state
  if (!currentVerseId && !suggestionVerseId) {
    return (
      <div className="h-full w-full flex flex-col overflow-hidden" data-testid="study-pane" style={{ backgroundColor: 'var(--theme-bg-primary)', color: 'var(--theme-text-primary)' }}>
        <PaneNavHeader canGoBack={canGoBack} canGoForward={canGoForward} pinned={pinned} onBack={goBack} onForward={goForward} onTogglePin={togglePin} />
        <div style={{ padding: '16px' }}>
          <TopicSearchBar onSelectTopic={handleSearchSelectTopic} placeholder={t('studyPane.searchTopicsPlaceholder')} />
        </div>
        <div className="flex items-center justify-center flex-1">
          <div className="text-center" style={{ color: 'var(--theme-text-secondary)' }}>
            <div style={{ fontSize: uiScaled(16), fontWeight: 500, marginBottom: '8px' }}>{t('studyPane.title')}</div>
            <div style={{ fontSize: uiScaled(13) }}>{t('studyPane.emptyHint')}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--theme-bg-primary)', color: 'var(--theme-text-primary)' }}
      data-testid="study-pane"
    >
      <PaneNavHeader canGoBack={canGoBack} canGoForward={canGoForward} pinned={pinned} onBack={goBack} onForward={goForward} onTogglePin={togglePin} />

      {/*
        Only a pinned pane can be out of step with the Bible pane now - an
        unpinned one follows the selected verse directly. This banner is the
        desktop equivalent of the web's "Pinned to X - Sync to Y" bar.
      */}
      {suggestionVerseId && (
        <SuggestionBanner
          verseId={suggestionVerseId}
          messagePrefix={t('studyPane.suggestionPrefix')}
          onGo={acceptSuggestion}
          onDismiss={dismissSuggestion}
        />
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '12px 12px 0' }}>
          {/* Passage the pane is showing */}
          {currentVerseId && !isCommentaryDetail && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginBottom: '10px',
            }}>
              <span style={{ fontSize: uiScaled(13), fontWeight: 600 }}>
                {t('studyPane.studyingVerse', { reference: verseLabel })}
              </span>
              <button
                onClick={clearVerse}
                style={{ border: 'none', backgroundColor: 'transparent', color: 'var(--theme-text-secondary)', cursor: 'pointer', fontSize: uiScaled(16), lineHeight: 1 }}
                title={t('studyPane.clearTitle')}
                aria-label={t('studyPane.clearTitle')}
              >
                &times;
              </button>
            </div>
          )}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--theme-text-secondary)', fontSize: uiScaled(13) }}>
            {t('studyPane.loadingData')}
          </div>
        )}

        {!loading && failedSections.length > 0 && (
          <div
            role="alert"
            data-testid="study-pane-load-error"
            style={{
              margin: '0 12px 12px',
              padding: '8px 10px',
              borderRadius: '6px',
              fontSize: uiScaled(12),
              color: 'var(--theme-danger-text)',
              backgroundColor: 'var(--theme-danger-soft)',
              border: '1px solid var(--theme-danger-border)',
            }}
          >
            {t(
              'studyPane.sectionLoadFailed',
              { sections: failedSections.map(key => t(key)).join(', '), },
            )}
          </div>
        )}

        {!loading && !isCommentaryDetail && (
          <>
            {/* Cross-References - first, matching the web pane's ordering */}
            <CrossReferencesSection
              xrefGroups={xrefGroups}
              sources={xrefSources}
              collapsed={!!sectionsCollapsed['xrefs']}
              onToggle={() => toggleSection('xrefs')}
            />

            {/* Topics.

                The topic search box lives here rather than at the top of the
                pane. Sitting above the passage's own sections it read as a
                search of the whole pane - of the cross-references and
                commentaries under it as much as the topics - when all it has
                ever searched is topics. Inside the section its scope is stated
                by where it is, and it collapses away with the rest of the
                section when the reader is not using it. */}
            <StudySection
              title={t('studyPane.topicsTitle')}
              count={topics.length}
              collapsed={!!sectionsCollapsed['topics']}
              onToggle={() => toggleSection('topics')}
            >
              <div style={{ marginBottom: '10px' }}>
                <TopicSearchBar onSelectTopic={handleSearchSelectTopic} placeholder={t('studyPane.searchTopicsPlaceholder')} />
              </div>
              <VerseTopicsList
                topics={topics}
                onTopicClick={handleTopicClick}
                scale={uiScaled}
                emptyState={<EmptyNote>{t('studyPane.noTopics')}</EmptyNote>}
              />
            </StudySection>

            {/* Combined Summary - the auto-generated digest, rendered in full */}
            {digestEntries.length > 0 && currentVerseId && (
              <StudySection
                title={t('studyPane.combinedSummaryTitle')}
                subtitle={t('studyPane.combinedSummarySubtitle')}
                collapsed={!!sectionsCollapsed['combinedSummary']}
                onToggle={() => toggleSection('combinedSummary')}
              >
                <CombinedSummary entries={digestEntries} verseId={currentVerseId} />
              </StudySection>
            )}

            {/* Other commentaries */}
            <StudySection
              title={t('studyPane.commentariesTitle')}
              count={otherCommentaries.length}
              collapsed={!!sectionsCollapsed['commentaries']}
              onToggle={() => toggleSection('commentaries')}
            >
              {otherCommentaries.length === 0 ? (
                <EmptyNote>{t('studyPane.noCommentaries')}</EmptyNote>
              ) : (
                /*
                  A real <button>, not a `<div onClick>`: the row activates
                  navigation, so it has to be reachable by Tab and by Enter or
                  Space. As a div it was invisible to the keyboard and
                  announced as nothing by a screen reader.
                */
                otherCommentaries.map((c) => (
                  <button
                    key={`${c.abbreviation}-${c.entry_id}`}
                    type="button"
                    data-testid="study-commentary-card"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'start',
                      border: 'none',
                      backgroundColor: 'transparent',
                      color: 'inherit',
                      font: 'inherit',
                      padding: '8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      marginBottom: '4px',
                    }}
                    onClick={() => openCommentaryDetail(currentVerseId!, c.abbreviation, c.entry_id)}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--theme-tab-bg-hover, rgba(0,0,0,0.05))'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', fontSize: uiScaled(13), fontWeight: 500, marginBottom: '2px' }}>
                      <span className="min-w-0 truncate" style={{ color: 'var(--theme-accent-primary)' }}>{c.name}</span>
                      <ModuleProvenanceBadge moduleAbbreviation={c.abbreviation} />
                      <span style={{ fontSize: uiScaled(11), color: 'var(--theme-text-secondary)' }} className="ms-auto flex-shrink-0">
                        {t('studyPane.wordCount', { count: c.word_count })}
                      </span>
                    </div>
                    <div style={{ fontSize: uiScaled(12), color: 'var(--theme-text-secondary)', lineHeight: '1.4' }}>
                      {c.preview}
                    </div>
                  </button>
                ))
              )}
            </StudySection>
          </>
        )}

        {/* Commentary Detail View */}
        {isCommentaryDetail && currentNavEntry?.type === 'commentary-detail' && (
          <div style={{ padding: '0 12px 12px' }}>
            <CommentaryDetailView
              abbreviation={currentNavEntry.commentaryAbbreviation}
              entryId={currentNavEntry.entryId}
              verseId={currentNavEntry.verseId}
              displayNameFor={displayNameFor}
              onBack={goBack}
            />
          </div>
        )}
      </div>
    </div>
  );
};

/** Muted "nothing here" line shared by every section. */
const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: uiScaled(12), color: 'var(--theme-text-secondary)', padding: '4px 0' }}>
    {children}
  </div>
);

/**
 * The auto-generated digest, rendered in place.
 *
 * The provenance notice comes first and the text points back at it, so a
 * screen reader reaches "this was machine generated" before the claims it
 * qualifies.
 */
const CombinedSummary: React.FC<{ entries: CommentarySummary[]; verseId: number }> = ({ entries, verseId }) => {
  const abbreviation = entries[0]?.abbreviation ?? '';
  const disclaimerId = `study-combined-summary-${abbreviation}`;
  return (
    <div>
      <DigestDisclaimer moduleAbbreviation={abbreviation} id={disclaimerId} className="mb-3" />
      {entries.map((entry) => (
        <StudyRichText
          key={entry.entry_id}
          content={entry.content}
          verseId={verseId}
          aria-describedby={disclaimerId}
        />
      ))}
    </div>
  );
};

/** Cross-references section with verse tooltips */
const CrossReferencesSection: React.FC<{
  xrefGroups: XrefGroupWithEntries[];
  sources: string[];
  collapsed: boolean;
  onToggle: () => void;
}> = ({ xrefGroups, sources, collapsed, onToggle }) => {
  const { t } = useI18n();
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    visible: boolean;
    verseId: number;
    endVerseId?: number;
    position: { x: number; y: number };
  }>({ visible: false, verseId: 0, position: { x: 0, y: 0 } });

  const showTooltip = useCallback((verseId: number, endVerseId: number | null, e: React.MouseEvent) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setTooltipState({
      visible: true,
      verseId,
      endVerseId: endVerseId ?? undefined,
      position: { x: e.clientX, y: e.clientY },
    });
  }, []);

  const hideTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setTooltipState(prev => ({ ...prev, visible: false }));
    }, 100);
  }, []);

  const cancelHideTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  // Whole-verse references first, then the phrase groups in module order -
  // the same ordering the web pane uses.
  //
  // Tested for absence, not for `=== null`: `CrossReferenceRepository` maps a
  // NULL phrase column to `undefined` on the way through the DTO, so the strict
  // null comparison never matched and whole-verse groups were never hoisted.
  const sorted = useMemo(
    () => [...xrefGroups].sort((a, b) => {
      const aWholeVerse = !a.group.phrase;
      const bWholeVerse = !b.group.phrase;
      if (aWholeVerse && !bWholeVerse) return -1;
      if (!aWholeVerse && bWholeVerse) return 1;
      return (a.group.sort_order ?? 0) - (b.group.sort_order ?? 0);
    }),
    [xrefGroups]
  );

  return (
    <StudySection
      title={t('studyPane.crossReferencesTitle')}
      subtitle={sources.length > 0 ? t('studyPane.crossReferencesSource', { source: sources.join(', ') }) : undefined}
      count={xrefGroups.reduce((sum, g) => sum + g.entries.length, 0)}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {sorted.length === 0 ? (
        <EmptyNote>{t('studyPane.noCrossReferences')}</EmptyNote>
      ) : (
        sorted.map((g) => {
          // The raw TSK phrase runs the keyword together with an editorial
          // aside ("locusts.The word {arbeh,}..."), and carries a trailing
          // period the quotes make redundant.
          const keyword = g.group.phrase ? tskPhraseKeyword(g.group.phrase) : null;
          const aside = g.group.phrase ? tskPhraseAside(g.group.phrase) : null;
          return (
            <div key={g.group.group_id} style={{ marginBottom: '6px', fontSize: uiScaled(12), color: 'var(--theme-text-secondary)' }}>
              {/* Keyword and references share a line - the shape the web pane
                  uses. A heading per group cost a line of height per phrase,
                  and a dense verse has a dozen of them. */}
              <strong style={{ fontWeight: 600, color: 'var(--theme-text-primary)' }} title={aside ?? undefined}>
                {keyword ? `"${keyword.replace(/\.+$/, '')}"` : t('studyPane.crossReferencesOverall')}
              </strong>
              {' — '}
              <ReferenceRun
                verseIds={targetVerseIdsFromGroup(g)}
                format="short"
                // No "+N more" here. The inline row under each verse in the
                // Bible text has to stay out of the reading, so it keeps the
                // 12-reference budget; this pane is the one the reader opened
                // TO read cross-references, and it scrolls.
                maxRefs={null}
                // A cross-reference is a glance. Previewing marks it in the
                // Bible text and raises a way back, without moving the verse
                // this pane - and the commentary, and the notes - are
                // following.
                onNavigateToVerse={(verseId, endVerseId) => previewVerseInPrimary(verseId, endVerseId)}
                onHoverReference={(verseId, endVerseId, ev) => showTooltip(verseId, endVerseId ?? null, ev)}
                onLeaveReference={hideTooltip}
              />
            </div>
          );
        })
      )}
      {tooltipState.visible && (
        <VersePreviewTooltip
          verseId={tooltipState.verseId}
          endVerseId={tooltipState.endVerseId}
          position={tooltipState.position}
          onClose={() => setTooltipState(prev => ({ ...prev, visible: false }))}
          onMouseEnter={cancelHideTooltip}
          onGoToVerse={() => {
            const targetVerseId = tooltipState.verseId;
            setTooltipState(prev => ({ ...prev, visible: false }));
            previewVerseInPrimary(targetVerseId, tooltipState.endVerseId);
          }}
          hint={t('versePreviewTooltip.hintClick')}
        />
      )}
    </StudySection>
  );
};

/**
 * Compact "this was machine generated" chip for the Study pane's commentary
 * list. Renders nothing for human-authored modules.
 */
const ModuleProvenanceBadge: React.FC<{ moduleAbbreviation: string }> = ({ moduleAbbreviation }) => {
  const { t } = useI18n();
  const kind = useModuleProvenance(moduleAbbreviation);
  if (!kind) return null;
  return (
    <span
      data-testid="study-provenance-badge"
      className="flex-shrink-0 rounded bg-info-soft px-1.5 py-0.5 text-[10px] font-medium text-info-text"
    >
      {t(MODULE_PROVENANCE_TEXT[kind].collapsedKey)}
    </span>
  );
};

/** Inline commentary detail view */
const CommentaryDetailView: React.FC<{
  abbreviation: string;
  entryId: number;
  verseId: number;
  displayNameFor: (abbreviation: string, moduleName: string) => string;
  onBack: () => void;
}> = ({ abbreviation, entryId, verseId, displayNameFor, onBack }) => {
  const { t } = useI18n();
  const provenanceKind = useModuleProvenance(abbreviation);
  const disclaimerId = `study-commentary-disclaimer-${abbreviation}`;
  const [content, setContent] = useState<string>('');
  const [commentaryName, setCommentaryName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const entries = await unwrap(window.electron.commentary.getEntriesForVerse(abbreviation, verseId));
        const entry = entries.find((e: { entry_id: number }) => e.entry_id === entryId);
        if (!cancelled && entry) {
          setContent(entry.content ?? '');
        }
        const info = await unwrap(window.electron.commentary.getCommentaryInfo(abbreviation));
        if (!cancelled && info) {
          setCommentaryName(displayNameFor(abbreviation, info.full_name));
        }
      } catch (error) {
        console.error('Error loading commentary detail:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [abbreviation, entryId, verseId, displayNameFor]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '12px 0' }}>
        <button
          onClick={onBack}
          style={{
            padding: '4px 10px',
            fontSize: uiScaled(12),
            border: '1px solid var(--theme-border-primary)',
            borderRadius: '4px',
            backgroundColor: 'transparent',
            color: 'var(--theme-text-primary)',
            cursor: 'pointer',
          }}
        >
          {t('studyPane.back')}
        </button>
        <span style={{ fontSize: uiScaled(14), fontWeight: 500 }}>{commentaryName}</span>
      </div>
      {loading ? (
        <div style={{ color: 'var(--theme-text-secondary)', fontSize: uiScaled(13) }}>{t('studyPane.loading')}</div>
      ) : (
        <>
          {/* Machine-generated content notice - renders nothing for human-authored modules */}
          <DigestDisclaimer
            moduleAbbreviation={abbreviation}
            id={disclaimerId}
            className="mb-3"
          />
          <StudyRichText
            content={content}
            verseId={verseId}
            aria-describedby={provenanceKind ? disclaimerId : undefined}
          />
        </>
      )}
    </div>
  );
};

export default StudyPane;
