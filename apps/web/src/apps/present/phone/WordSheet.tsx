import { useMemo, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { usePassage, selectedVerses } from '../../../present/usePassage';
import { tokenizeVerse } from '../../../present/tokenize';
import { notesStore } from '../notes/notesStore';
import type { PlanItem } from '../notes/notesStore';
import { Sheet } from './Sheet';
import { isWordPicked, phraseOf, tapWord, type WordPick } from './wordPick';

/**
 * "Set by editing the verse": the verse as tappable words. Tap a first and a
 * last word to add that phrase as a highlight under the verse. Existing
 * highlights are listed with a Remove button. No rich text anywhere.
 */
export function WordSheet(props: { entry: PlanItem; onClose: () => void }) {
  const { t } = useTranslation();
  const { entry } = props;
  const passage = usePassage(entry.item);
  const [pick, setPick] = useState<WordPick | null>(null);

  const verses = useMemo(
    () => (passage && entry.item ? selectedVerses(passage, entry.item) : []).map(v => ({
      verseId: v.verse_id,
      verse: v.verse,
      tokens: tokenizeVerse(v.text_html),
    })),
    [passage, entry.item],
  );

  const onWord = (verseId: number, index: number, displays: string[]): void => {
    const result = tapWord(pick, verseId, index);
    if (result.kind === 'start') {
      setPick(result.pick);
      return;
    }
    const phrase = phraseOf(displays, result.start, result.end);
    setPick(null);
    if (phrase) notesStore.addHighlightText(entry.id, phrase);
  };

  const removeHighlight = (id: string): void => {
    const store = notesStore as unknown as { removeHighlightText?: (id: string) => void };
    if (store.removeHighlightText) store.removeHighlightText(id);
    else notesStore.dismissHighlight(id);
  };

  return (
    <Sheet title={t('present.phone.editTitle', { label: entry.label })} onClose={props.onClose}>
      <p class="pz-hint">{pick ? t('present.phone.pickLast') : t('present.phone.pickFirst')}</p>

      {entry.highlights.length > 0 && (
        <ul class="pzp-existing">
          {entry.highlights.map(h => (
            <li key={h.id}>
              <span>{h.text}</span>
              <button type="button" class="pz-btn" onClick={() => removeHighlight(h.id)}>{t('present.phone.remove')}</button>
            </li>
          ))}
        </ul>
      )}

      {!passage && <p class="pz-hint">{t('present.phone.loadingVerse')}</p>}
      <div class="pzp-verses">
        {verses.map(v => {
          const displays = v.tokens.map(token => token.displayText);
          return (
            <p key={v.verseId} class="pzp-verse">
              <sup>{v.verse}</sup>
              {v.tokens.map((token, i) => (
                <button
                  key={i}
                  type="button"
                  class={`pzp-word ${isWordPicked(pick, v.verseId, i) ? 'pzp-word--picked' : ''}`}
                  onClick={() => onWord(v.verseId, i, displays)}
                >
                  {token.displayText}
                </button>
              ))}
            </p>
          );
        })}
      </div>

      <div class="pz-picker__actions">
        {pick && <button type="button" class="pz-btn" onClick={() => setPick(null)}>{t('common.cancel')}</button>}
        <button type="button" class="pz-btn pz-btn--primary" onClick={props.onClose}>{t('present.phone.done')}</button>
      </div>
    </Sheet>
  );
}
