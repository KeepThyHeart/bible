import { useState, useEffect, useCallback } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useVersePopup } from '../../hooks/useVersePopup';
import { commentaryStore, HOME_TAB_ID } from '../../stores/commentaryStore';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';
import { processCommentaryLinks } from '../../../../../packages/core/src/Services/CommentaryLinkProcessor';
import { renderMarkdownToHtml } from '../../utils/markdownRenderer';
import { sanitizeHtml } from '../../utils/sanitize';
import { parseVerseId, formatVerseRange, isTskModule } from '../../utils/verseId';
import { filterCommentaryEntries } from '../../utils/commentaryEntries';
import { isDigestModule, getDigestDisplayName, getDigestDisclaimer, getModuleDisclaimer } from '../../moduleDescriptions';
import { DigestDisclaimer } from './DigestDisclaimer';
import type { IBibleDataProvider } from '../../providers/interfaces';
import type { CommentaryModuleInfoData } from '../../types';
import { CommentaryHome } from './CommentaryHome';

interface CommentaryContentProps {
  bibleProvider?: IBibleDataProvider;
}

export function CommentaryContent({ bibleProvider }: CommentaryContentProps) {
  const { t } = useTranslation();
  const entries = useStore(commentaryStore, () => commentaryStore.entries);
  const loading = useStore(commentaryStore, () => commentaryStore.loading);
  const syncedBook = useStore(commentaryStore, () => commentaryStore.syncedBook);
  const syncedChapter = useStore(commentaryStore, () => commentaryStore.syncedChapter);
  const tabs = useStore(commentaryStore, () => commentaryStore.tabs);
  const activeTabId = useStore(commentaryStore, () => commentaryStore.activeTabId);
  const liveHighlightedVerse = useStore(bibleStore, () => bibleStore.getActiveTab()?.studyVerse);
  const pinned = useStore(commentaryStore, () => commentaryStore.pinned);
  const pinnedVerse = useStore(commentaryStore, () => commentaryStore.pinnedVerse);
  const overrideVerse = useStore(commentaryStore, () => commentaryStore.overrideVerse);

  const { containerProps: versePopupProps, popupJsx: versePopupJsx } = useVersePopup(bibleProvider);

  // For pinned tabs, use the pinned book/chapter instead of the global synced values
  const activeTabForLoad = tabs.find(t => t.id === activeTabId);
  const effectiveBook = (activeTabForLoad?.pinned && activeTabForLoad.pinnedBook) ? activeTabForLoad.pinnedBook : syncedBook;
  const effectiveChapter = (activeTabForLoad?.pinned && activeTabForLoad.pinnedChapter) ? activeTabForLoad.pinnedChapter : syncedChapter;

  // When pinned, freeze the verse; override takes priority for commentary-only navigation
  const baseVerse = pinned ? pinnedVerse : liveHighlightedVerse;
  const rawHighlightedVerse = overrideVerse ?? baseVerse;
  // Validate that the highlighted verse belongs to the effective book/chapter to avoid stale mismatches
  const highlightedVerse = (() => {
    if (!rawHighlightedVerse || !effectiveBook || !effectiveChapter) return rawHighlightedVerse;
    const { bookNumber, chapter } = parseVerseId(rawHighlightedVerse);
    return bookNumber === effectiveBook && chapter === effectiveChapter ? rawHighlightedVerse : null;
  })();

  // Clear override when Bible verse changes
  useEffect(() => {
    commentaryStore.setOverrideVerse(null);
  }, [liveHighlightedVerse]);

  const chapterVerses = useStore(commentaryStore, () => {
    const tab = commentaryStore.tabs.find(t => t.id === commentaryStore.activeTabId);
    return tab ? commentaryStore.chapterVersesCache.get(tab.moduleAbbr) : undefined;
  });

  // Always load chapter verses for the active tab (use effective book/chapter for pinned tabs)
  useEffect(() => {
    if (!activeTabForLoad || activeTabForLoad.id === HOME_TAB_ID || !effectiveBook || !effectiveChapter) return;
    commentaryStore.loadChapterVerses(activeTabForLoad.moduleAbbr, effectiveBook, effectiveChapter);
  }, [activeTabForLoad?.moduleAbbr, effectiveBook, effectiveChapter]);

  // Auto-select the first visible verse when no verse is highlighted.
  // Must be before any conditional early return to keep hook order stable.
  useEffect(() => {
    if (!highlightedVerse && effectiveBook && effectiveChapter) {
      const visibleVerseId = bibleStore.getFirstVisibleVerseId();
      if (visibleVerseId) {
        bibleStore.adoptPreviewAsStudy(visibleVerseId);
      }
    }
  }, [highlightedVerse, effectiveBook, effectiveChapter]);

  // If home tab is active and overview is enabled, render the CommentaryHome component
  if (activeTabId === HOME_TAB_ID && settingsStore.showCommentaryOverview) {
    return <CommentaryHome bibleProvider={bibleProvider} />;
  }

  if (tabs.filter(t => t.id !== HOME_TAB_ID).length === 0) {
    return (
      <div class="commentary-content commentary-content--empty">
        <i class="fa-solid fa-comment-dots fa-2x" style={{ opacity: 0.3, marginBottom: '8px' }} />
        <p>{t('commentaryContent.noSelected')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div class="commentary-content commentary-content--loading">
        <i class="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px' }} />
        {t('commentaryContent.loading')}
      </div>
    );
  }

  if (!syncedBook || !syncedChapter) {
    return (
      <div class="commentary-content commentary-content--empty">
        <p>{t('commentaryContent.navigateToPassage')}</p>
      </div>
    );
  }

  // Filter and split entries into verse-specific and passage-level groups
  const { verse: verseEntries, passage: passageEntries } = filterCommentaryEntries(entries, highlightedVerse);
  const filteredEntries = [...verseEntries, ...passageEntries];

  if (filteredEntries.length === 0) {
    if (!highlightedVerse) {
      // No verse selected and auto-select couldn't find one (e.g. Bible pane not
      // mounted yet, or verses still loading). Prompt the user instead of stalling.
      return (
        <div class="commentary-content commentary-content--empty">
          <i class="fa-solid fa-book-open fa-2x" style={{ opacity: 0.3, marginBottom: '8px' }} />
          <p>{t('commentaryContent.selectVerseToSeeCommentary')}</p>
        </div>
      );
    }

    // No content for this verse - show navigation to nearby verses with content
    const activeTabInfo = tabs.find(t => t.id === activeTabId);
    return (
      <CommentaryEmptyVerse
        highlightedVerse={highlightedVerse}
        syncedBook={syncedBook}
        syncedChapter={syncedChapter}
        chapterVerses={chapterVerses}
        activeModuleAbbr={activeTabInfo?.moduleAbbr}
        activeModuleName={activeTabInfo?.moduleName}
      />
    );
  }

  // Determine the active commentary module abbreviation and content format
  const activeTab = tabs.find(t => t.id === activeTabId);
  const matchBareVerseNumbers = activeTab ? isTskModule(activeTab.moduleAbbr) : false;
  const contentFormat = activeTab ? commentaryStore.getContentFormat(activeTab.moduleAbbr) : 'html';
  const isDigest = activeTab ? isDigestModule(activeTab.moduleAbbr) : false;
  const moduleDisclaimer = activeTab ? getModuleDisclaimer(activeTab.moduleAbbr) : undefined;

  return (
    <div
      class="commentary-content"
      {...versePopupProps}
    >
      {moduleDisclaimer && <DigestDisclaimer moduleAbbr={activeTab?.moduleAbbr} />}
      {verseEntries.map(entry => {
        const entryParsed = parseVerseId(entry.verse_id_start);
        const htmlContent = contentFormat === 'markdown' ? renderMarkdownToHtml(entry.content) : entry.content;
        const linkedContent = processCommentaryLinks(htmlContent, {
          bookNumber: entryParsed.bookNumber,
          chapter: entryParsed.chapter,
          matchBareVerseNumbers,
        });
        return (
          <div key={entry.entry_id} class="commentary-entry">
            <div class="commentary-entry__ref">
              {formatVerseRange(entry.verse_id_start, entry.verse_id_end)}
            </div>
            <div
              class="commentary-entry__text"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(linkedContent) }}
            />
          </div>
        );
      })}
      {passageEntries.length > 0 && (
        <>
          {verseEntries.length > 0 && (
            <div class="commentary-section-divider">
              <span>{t('commentaryContent.commentaryOnPassage')}</span>
            </div>
          )}
          {passageEntries.map(entry => {
            const entryParsed = parseVerseId(entry.verse_id_start);
            const htmlContent = contentFormat === 'markdown' ? renderMarkdownToHtml(entry.content) : entry.content;
            const linkedContent = processCommentaryLinks(htmlContent, {
              bookNumber: entryParsed.bookNumber,
              chapter: entryParsed.chapter,
              matchBareVerseNumbers,
            });
            return (
              <div key={entry.entry_id} class="commentary-entry">
                <div class="commentary-entry__ref">
                  {formatVerseRange(entry.verse_id_start, entry.verse_id_end)}
                </div>
                <div
                  class="commentary-entry__text"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(linkedContent) }}
                />
              </div>
            );
          })}
        </>
      )}
      {/* Subtle module disclaimer at bottom */}
      {moduleDisclaimer && (verseEntries.length > 0 || passageEntries.length > 0) && (
        <div class="digest-disclaimer-footer">
          <i class="fa-solid fa-circle-info" /> {moduleDisclaimer}
        </div>
      )}
      {/* Prev/next verse navigation at bottom of commentary */}
      {highlightedVerse && (
        <CommentaryVerseNav
          highlightedVerse={highlightedVerse}
          syncedBook={syncedBook}
          syncedChapter={syncedChapter}
          chapterVerses={chapterVerses}
        />
      )}
      {/* Pinned notice at bottom of content */}
      {pinned && (() => {
        const bibleTab = bibleStore.getActiveTab();
        if (!bibleTab?.book || !bibleTab?.chapter) return null;
        const bibleBookName = moduleStore.getBookName(bibleTab.book);
        const currentVerse = bibleTab.previewVerse ?? bibleTab.studyVerse;
        const bibleVerse = currentVerse ? currentVerse % 1000 : null;
        const bibleRef = bibleVerse
          ? `${bibleBookName} ${bibleTab.chapter}:${bibleVerse}`
          : `${bibleBookName} ${bibleTab.chapter}`;
        return (
          <div class="commentary-pinned-footer">
            <i class="fa-solid fa-thumbtack" />
            <span>{t('commentaryContent.isPinned')}</span>
            <button
              class="commentary-pinned-footer__sync"
              onClick={() => {
                commentaryStore.unpin();
                if (bibleTab.book && bibleTab.chapter) {
                  commentaryStore.loadForChapter(bibleTab.book, bibleTab.chapter);
                  if (bibleTab.previewVerse) {
                    bibleStore.adoptPreviewAsStudy(bibleTab.previewVerse);
                  }
                }
              }}
            >
              {t('commentaryContent.syncTo')} {bibleRef} <i class="fa-solid fa-rotate fa-xs" />
            </button>
          </div>
        );
      })()}
      {/* About this commentary — expandable section */}
      {activeTab && activeTab.id !== HOME_TAB_ID && !isDigest && (verseEntries.length > 0 || passageEntries.length > 0) && (
        <CommentaryAbout moduleAbbr={activeTab.moduleAbbr} />
      )}
      {versePopupJsx}
    </div>
  );
}

/** Expandable "About" section at the bottom of commentary content */
export function CommentaryAbout({ moduleAbbr }: { moduleAbbr: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [info, setInfo] = useState<CommentaryModuleInfoData | null>(null);
  const [loading, setLoading] = useState(false);

  const handleToggle = useCallback(() => {
    if (!expanded && !info) {
      setLoading(true);
      commentaryStore.getModuleInfo(moduleAbbr).then(data => {
        setInfo(data);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
    setExpanded(prev => !prev);
  }, [expanded, info, moduleAbbr]);

  // Reset when module changes
  useEffect(() => {
    setExpanded(false);
    setInfo(null);
  }, [moduleAbbr]);

  return (
    <div class="commentary-about">
      <button class="commentary-about__toggle" onClick={handleToggle}>
        <i class={`fa-solid fa-${expanded ? 'chevron-up' : 'circle-info'} fa-xs`} />
        {' '}{t('commentaryContent.about')}
      </button>
      {expanded && (
        <div class="commentary-about__content">
          {loading ? (
            <div class="commentary-about__loading">
              <i class="fa-solid fa-spinner fa-spin" />
            </div>
          ) : info ? (
            <dl class="commentary-about__details">
              {info.fullName && (
                <><dt>{t('commentaryContent.aboutName')}</dt><dd>{info.fullName}</dd></>
              )}
              {info.author && (
                <><dt>{t('commentaryContent.aboutAuthor')}</dt><dd>{info.author}</dd></>
              )}
              {info.yearPublished && (
                <><dt>{t('commentaryContent.aboutYear')}</dt><dd>{info.yearPublished}</dd></>
              )}
              {info.description && (
                <><dt>{t('commentaryContent.aboutDescription')}</dt><dd>{info.description}</dd></>
              )}
              {info.copyright && (
                <><dt>{t('commentaryContent.aboutLicense')}</dt><dd>{info.copyright}</dd></>
              )}
              {info.publisher && (
                <><dt>{t('commentaryContent.aboutPublisher')}</dt><dd>{info.publisher}</dd></>
              )}
              {info.languageCode && (
                <><dt>{t('commentaryContent.aboutLanguage')}</dt><dd>{info.languageCode.toUpperCase()}</dd></>
              )}
            </dl>
          ) : (
            <div class="commentary-about__empty">{t('commentaryContent.aboutUnavailable')}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Prev/next comment navigation shown below commentary content */
function CommentaryVerseNav({ highlightedVerse, syncedBook, syncedChapter, chapterVerses }: {
  highlightedVerse: number;
  syncedBook: number | null;
  syncedChapter: number | null;
  chapterVerses?: number[];
}) {
  const { t } = useTranslation();
  if (!chapterVerses || chapterVerses.length === 0) return null;

  const currentVerse = highlightedVerse % 1000;

  let prevVerse: number | null = null;
  let nextVerse: number | null = null;
  for (let i = chapterVerses.length - 1; i >= 0; i--) {
    if (chapterVerses[i] < currentVerse) { prevVerse = chapterVerses[i]; break; }
  }
  for (let i = 0; i < chapterVerses.length; i++) {
    if (chapterVerses[i] > currentVerse) { nextVerse = chapterVerses[i]; break; }
  }

  if (!prevVerse && !nextVerse) return null;

  const navigateToVerse = (verse: number) => {
    if (syncedBook && syncedChapter) {
      const verseId = (syncedBook * 1000000) + (syncedChapter * 1000) + verse;
      commentaryStore.setOverrideVerse(verseId);
      // Also update the Bible pane's selected verse and scroll to it
      bibleStore.adoptPreviewAsStudy(verseId);
      bibleStore.scrollToVerse(verseId);
    }
  };

  return (
    <div class="commentary-empty-verse__nav">
      {prevVerse ? (
        <button class="commentary-empty-verse__nav-btn" onClick={() => navigateToVerse(prevVerse!)}>
          <i class="fa-solid fa-chevron-left fa-xs" /> {t('commentaryContent.prevComment')} {prevVerse})
        </button>
      ) : <span />}
      {nextVerse ? (
        <button class="commentary-empty-verse__nav-btn" onClick={() => navigateToVerse(nextVerse!)}>
          {t('commentaryContent.nextComment')} {nextVerse}) <i class="fa-solid fa-chevron-right fa-xs" />
        </button>
      ) : <span />}
    </div>
  );
}

/** Component shown when the active commentary has no content for the selected verse */
function CommentaryEmptyVerse({ highlightedVerse, syncedBook, syncedChapter, chapterVerses, activeModuleAbbr, activeModuleName }: {
  highlightedVerse: number;
  syncedBook: number | null;
  syncedChapter: number | null;
  chapterVerses?: number[];
  activeModuleAbbr?: string;
  activeModuleName?: string;
}) {
  const { t } = useTranslation();
  const hasChapterContent = chapterVerses && chapterVerses.length > 0;
  const homeData = useStore(commentaryStore, () => commentaryStore.homeData);

  // Load home data if not already loaded (normally loaded by CommentaryHome, but we need it here too)
  useEffect(() => {
    if (syncedBook && syncedChapter) {
      const verse = highlightedVerse
        ? highlightedVerse - (syncedBook * 1000000) - (syncedChapter * 1000)
        : undefined;
      commentaryStore.loadHomeData(syncedBook, syncedChapter, verse);
    }
  }, [syncedBook, syncedChapter, highlightedVerse]);

  // Find other commentaries that have content for this verse
  const otherVerseModules = homeData?.verseModules?.filter(m => m.moduleAbbr !== activeModuleAbbr) ?? [];
  const otherPassageModules = homeData?.passageModules?.filter(m => m.moduleAbbr !== activeModuleAbbr) ?? [];
  const hasOtherContent = otherVerseModules.length > 0 || otherPassageModules.length > 0;

  // Falls back to the abbreviation when a module ships no distinct name — but
  // never for the digest, whose abbreviation is "SYNTHESIS" and whose name is
  // "Combined Summary" everywhere else in the app.
  const displayName = isDigestModule(activeModuleAbbr ?? '')
    ? getDigestDisplayName()
    : activeModuleName && activeModuleName !== activeModuleAbbr
      ? activeModuleName
      : activeModuleAbbr;

  return (
    <div class="commentary-content commentary-empty-verse">
      <p class="commentary-empty-verse__message">
        {t('commentaryContent.noCommentary')}{displayName ? ` in ${displayName}` : ''}.
      </p>

      {hasOtherContent && (
        <div class="commentary-empty-verse__others">
          <button
            class="commentary-empty-verse__see-others"
            onClick={() => commentaryStore.setActiveTab(HOME_TAB_ID)}
          >
            {t('commentaryContent.seeOther')}
          </button>
          {otherVerseModules.length > 0 && (
            <p class="commentary-empty-verse__other-list">
              {t('commentaryContent.verseLevelNotes')}{' '}
              {otherVerseModules.map((m, i) => (
                <span key={m.moduleAbbr}>
                  {i > 0 && ', '}
                  <button
                    class="commentary-empty-verse__module-link"
                    onClick={() => commentaryStore.openTemporaryTab(m.moduleAbbr, m.moduleName)}
                  >
                    {isDigestModule(m.moduleAbbr) ? getDigestDisplayName() : m.moduleAbbr}
                  </button>
                </span>
              ))}
              .
            </p>
          )}
          {otherPassageModules.length > 0 && (
            <p class="commentary-empty-verse__other-list">
              {t('commentaryContent.passageLevelNotes')}{' '}
              {otherPassageModules.map((m, i) => (
                <span key={m.moduleAbbr}>
                  {i > 0 && ', '}
                  <button
                    class="commentary-empty-verse__module-link"
                    onClick={() => commentaryStore.openTemporaryTab(m.moduleAbbr, m.moduleName)}
                  >
                    {isDigestModule(m.moduleAbbr) ? getDigestDisplayName() : m.moduleAbbr}
                  </button>
                </span>
              ))}
              .
            </p>
          )}
        </div>
      )}

      {hasChapterContent && (
        <CommentaryVerseNav
          highlightedVerse={highlightedVerse}
          syncedBook={syncedBook}
          syncedChapter={syncedChapter}
          chapterVerses={chapterVerses}
        />
      )}

      {!hasChapterContent && chapterVerses !== undefined && (
        <p class="commentary-empty-verse__no-chapter">
          {t('commentaryContent.noEntriesChapter')}
        </p>
      )}
    </div>
  );
}
