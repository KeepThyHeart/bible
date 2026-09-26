import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../hooks/useStore';
import { bibleStore } from '../../stores/bibleStore';
import { presentStore } from '../../stores/presentStore';
import { tokenizeVerse } from '../../present/tokenize';
import { draftIsOnWall } from '../../present/wordHighlight';
import { parseVerseId } from '../../utils/verseId';
import { isTyping } from './usePresenterShortcuts';

/**
 * The word-highlight draft's whole lifecycle, kept in one place so the
 * "tap the ends" gesture in `VerseRenderer` stays a pure gesture:
 *
 *  - A draft that has not been sent belongs to the active verse. Once the
 *    presenter moves to another verse it is meaningless there, so it is
 *    dropped -- silently, since the screen never saw it.
 *  - A draft that *was* on the screen is dropped when the screen's highlight
 *    goes away for any other reason (the wall moved on to another verse, or
 *    another controller cleared it), so this device never keeps offering a
 *    "highlight on screen" that is no longer there.
 *
 * Called from `BibleContent`, which is mounted for the whole of a session, so
 * this runs whether or not the bar below is currently drawn.
 */
export function useHighlightDraftLifecycle(): void {
  const draft = useStore(presentStore, () => presentStore.highlightDraft);
  const wall = useStore(presentStore, () => presentStore.wall);
  const studyVerse = useStore(bibleStore, () => bibleStore.getActiveTab()?.studyVerse ?? null);
  const wallHighlight = wall?.position.highlight ?? null;
  const wasSent = useRef(false);

  useEffect(() => {
    if (!draft) {
      wasSent.current = false;
      return;
    }
    const sent = draftIsOnWall(draft, wallHighlight);
    if (sent) {
      wasSent.current = true;
      return;
    }
    if (wasSent.current && wallHighlight === null) {
      // It was up, and now nothing is.
      wasSent.current = false;
      presentStore.discardHighlightDraft();
      return;
    }
    if (!wasSent.current && studyVerse !== draft.verseId) {
      presentStore.discardHighlightDraft();
    }
  }, [draft, wallHighlight, studyVerse]);
}

/**
 * Docked to the bottom of the Bible pane while a highlight draft exists:
 * what it says, whether it is on the screen, and the two buttons that
 * matter -- Send, and Clear. Docked rather than floating over the text, so
 * it never covers the verse being highlighted.
 *
 * Esc clears it too, the same as tapping the highlight itself.
 */
export function PresentHighlightBar() {
  const { t } = useTranslation();
  const session = useStore(presentStore, () => presentStore.session);
  const draft = useStore(presentStore, () => presentStore.highlightDraft);
  const wall = useStore(presentStore, () => presentStore.wall);
  const tab = useStore(bibleStore, () => bibleStore.getActiveTab());
  const active = Boolean(session && draft);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || isTyping(event.target)) return;
      presentStore.clearHighlight();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!session || !draft || !tab?.book || !tab.chapter) return null;

  const verse = tab.verses.find(v => v.verse_id === draft.verseId);
  const tokens = verse ? tokenizeVerse(verse.text_html) : [];
  const phrase = tokens.slice(draft.start, draft.end + 1).map(token => token.displayText).join(' ');
  const sent = draftIsOnWall(draft, wall?.position.highlight ?? null);
  const verseNumber = parseVerseId(draft.verseId).verse;

  const send = (): void => {
    void presentStore.sendHighlight(
      { kind: 'passage', module: tab.moduleAbbr, book: tab.book!, chapter: tab.chapter! },
      verseNumber,
    );
  };

  return (
    <div class={`present-highlight-bar${sent ? ' present-highlight-bar--sent' : ''}`} role="region" aria-label={t('present.highlight.label')}>
      <div class="present-highlight-bar__text">
        <span class="present-highlight-bar__state">
          {sent ? t('present.highlight.onScreen') : t('present.highlight.draft', { verse: verseNumber })}
        </span>
        <span class="present-highlight-bar__phrase">{phrase}</span>
      </div>
      <button type="button" class="present-highlight-bar__btn" onClick={() => presentStore.clearHighlight()}>
        {t('present.highlight.clear')}
      </button>
      <button
        type="button"
        class="present-highlight-bar__btn present-highlight-bar__btn--send"
        disabled={sent}
        onClick={send}
      >
        {t('present.highlight.send')}
      </button>
    </div>
  );
}
