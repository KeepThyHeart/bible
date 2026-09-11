import { useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { studyStore } from '../../stores/studyStore';
import { bibleStore } from '../../stores/bibleStore';
import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';
import { buildVerseInterlinearCells, normalizeStrongsNumber } from '../../utils/interlinearRows';
import { sanitizeHtml } from '../../utils/sanitize';
import { StackedInterlinear, InlineInterlinear } from '../BiblePane/InterlinearLayouts';
import { InterlinearLayoutToggle } from '../BiblePane/InterlinearLayoutToggle';

interface StudyHomeProps {
  onStrongsClick?: (strongsNumber: string) => void;
  onStrongsHover?: (strongsNumber: string, rect: DOMRect) => void;
  onStrongsLeave?: () => void;
}

/**
 * Study pane → Interlinear section: the selected verse's original-language
 * words, in either layout.
 *
 * **The English always comes from the selected translation.** The interlinear
 * *adds* a line under the translation's own words; it never restates them. So
 * this renders the verse's `text_html`, split into cells, exactly as the Bible
 * pane does — see `utils/interlinearCells.ts`.
 *
 * Printing the interlinear rows' glosses instead — which is what this did when
 * it had no verse text — is the reported bug: the module's wording in the
 * module's order ("only born" where the KJV reads "only begotten"), the same
 * Greek word printed twice, and an English-less row wherever a Greek article
 * carries no gloss. None of that is the translation the reader chose. When the
 * cells cannot be built the fallback is the plain verse, the same way
 * `VerseRenderer` fails soft; the glosses appear only as clearly-labelled
 * lexicon information, and only when the verse text itself cannot be had.
 */
export function StudyHome({ onStrongsClick, onStrongsHover, onStrongsLeave }: StudyHomeProps) {
  const { t } = useTranslation();
  const interlinearData = useStore(studyStore, () => studyStore.interlinearData);
  const interlinearLoading = useStore(studyStore, () => studyStore.interlinearLoading);
  const footnotes = useStore(studyStore, () => studyStore.footnotes);
  const verseId = useStore(studyStore, () => studyStore.verseId);
  const layout = useStore(settingsStore, () => settingsStore.interlinearLayout);

  // The verse's own text is the English word space the rows index into. It
  // comes from the Bible pane when that pane is on this chapter, and otherwise
  // from studyStore's own fetch — subscribed to both stores because either can
  // be the one that produces it.
  const tabVerseHtml = useStore(bibleStore, () =>
    bibleStore.getActiveTab()?.verses.find(v => v.verse_id === verseId)?.text_html
  );
  const fetchedVerseHtml = useStore(studyStore, () => studyStore.getVerseHtml());
  const verseTextLoading = useStore(studyStore, () => studyStore.verseHtmlLoading);
  const verseText = tabVerseHtml ?? fetchedVerseHtml ?? null;

  // This section is collapsed until the reader opens it, and `StudySection`
  // renders no children while collapsed — so being mounted at all is what says
  // the chapter's interlinear rows (~155 KB) are actually wanted. The store
  // used to fetch them on every verse selection regardless, including in
  // Standard mode with the Study pane closed.
  useEffect(() => {
    studyStore.ensureInterlinear();
  }, [verseId]);

  if (interlinearLoading) {
    return <div class="study-home__loading">{t('studyHome.loading')}</div>;
  }

  const verseWords = interlinearData?.words?.filter(w => w.verseId === verseId) ?? [];
  const strongsEntries = interlinearData?.strongsEntries ?? {};
  const hasInterlinear = verseWords.length > 0;

  // Null when the rows cannot be aligned against this verse's own words; the
  // helper warns, naming the verse and the counts, so a module whose positions
  // stop partitioning its token space is visible rather than silently changing
  // what the page says.
  const cells = verseText
    ? buildVerseInterlinearCells('StudyHome', verseId, verseText, verseWords)
    : null;

  const handlers = { onStrongsClick, onStrongsHover, onStrongsLeave };

  const interlinearBody = (() => {
    if (cells) {
      return layout === 'inline'
        ? <InlineInterlinear cells={cells} strongsEntries={strongsEntries} {...handlers} />
        : <StackedInterlinear cells={cells} strongsEntries={strongsEntries} {...handlers} />;
    }

    // Verse text in hand but unusable rows: show the verse. It is the verse,
    // not a degraded copy of it.
    if (verseText) {
      return (
        <div class="verse__body study-home__plain-verse">
          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(verseText) }} />
        </div>
      );
    }

    if (verseTextLoading) {
      return <div class="study-home__loading">{t('studyHome.loading')}</div>;
    }

    // No verse text at all (the fetch failed). The original-language words are
    // still worth showing, but only as themselves: the original word leads and
    // the gloss is labelled as the lexicon's, so nothing here can be mistaken
    // for the translation's wording.
    return (
      <div class="study-home__lexicon">
        <div class="study-home__lexicon-note">
          <i class="fa-solid fa-circle-info" /> {t('studyHome.verseTextUnavailable')}
        </div>
        {verseWords.map((w, i) => {
          const strongsNumber = w.strongsNumber ? normalizeStrongsNumber(w.strongsNumber) : '';
          const gloss = w.gloss || (strongsNumber ? strongsEntries[strongsNumber]?.briefMeaning : '') || '';
          return (
            <span key={i} class="study-home__lexicon-item">
              {w.originalWord && (
                <span class="study-home__lexicon-original">{w.originalWord}</span>
              )}
              {w.transliteration && (
                <span class="study-home__lexicon-translit">{w.transliteration}</span>
              )}
              {gloss && (
                <span class="study-home__lexicon-gloss" title={t('studyHome.lexiconGloss')}>
                  {gloss}
                </span>
              )}
              {strongsNumber && (
                <sup
                  class="verse__strongs-link"
                  title={gloss || strongsNumber}
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    onStrongsClick?.(strongsNumber);
                  }}
                  onMouseEnter={(e: MouseEvent) => {
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    onStrongsHover?.(strongsNumber, rect);
                  }}
                  onMouseLeave={() => onStrongsLeave?.()}
                >
                  {strongsNumber}
                </sup>
              )}
            </span>
          );
        })}
      </div>
    );
  })();

  return (
    <div class="study-home">
      <div class="study-home__section">
        {hasInterlinear ? (
          <>
            {/* The toggle picks between the two cell layouts, so it is only
                shown when cells are what is on screen. */}
            {cells && (
              <div class="study-home__section-controls">
                <InterlinearLayoutToggle />
              </div>
            )}
            {interlinearBody}
          </>
        ) : (
          <div class="study-home__empty">
            <i class="fa-solid fa-circle-info" /> {t('studyHome.interlinearUnavailable')}
          </div>
        )}
      </div>

      {footnotes.length > 0 && (
        <div class="study-home__section">
          <div class="study-home__section-header">{t('studyHome.footnotes')}</div>
          <div class="study-home__footnotes">
            {footnotes.map((fn, i) => (
              <div key={i} class="study-home__footnote">
                <span class="study-home__footnote-marker">[{fn.marker}]</span>{' '}
                <span class="study-home__footnote-text">{fn.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
