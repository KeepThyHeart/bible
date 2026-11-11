import { useTranslation } from 'react-i18next';
import { usePassage, selectedVerses } from '../../lib/usePassage';
import { describeItem } from '../../study/usePresenter';
import { usePresenterState } from '../presenterSink';
import { onScreenSummary } from './planLogic';

/** What the room sees right now: reference and a line of text, or "Screen hidden" / "Nothing on screen yet". */
export function OnScreenCard() {
  const { t } = useTranslation();
  const state = usePresenterState();
  const live = state?.live ?? null;
  const passage = usePassage(live?.kind === 'passage' ? live : null);
  const index = state?.position.index ?? 0;

  let verseText: string | null = null;
  if (passage && live?.kind === 'passage') {
    const verses = selectedVerses(passage, live);
    verseText = (verses.find(v => v.verse === index) ?? verses[0])?.text ?? null;
  }
  const title = describeItem(live, live?.kind === 'passage' ? index : 0);
  const summary = onScreenSummary(live, state?.display.blanked ?? false, title, verseText);

  return (
    <div class={`pzp-onscreen pzp-onscreen--${summary.mode}`} role="status" aria-label={t('present.phone.onScreen', { defaultValue: 'On screen' })}>
      <span class="pzp-onscreen__tag">{t('present.phone.onScreen', { defaultValue: 'On screen' })}</span>
      {summary.mode === 'empty' && (
        <span class="pzp-onscreen__title">{t('present.phone.nothingOnScreen', { defaultValue: 'Nothing on screen yet' })}</span>
      )}
      {summary.mode === 'hidden' && (
        <span class="pzp-onscreen__title">
          {t('present.phone.screenHidden', { defaultValue: 'Screen hidden' })}
          {summary.title ? ` (${summary.title})` : ''}
        </span>
      )}
      {summary.mode === 'item' && (
        <>
          {summary.title && <span class="pzp-onscreen__title">{summary.title}</span>}
          {summary.line && <span class="pzp-onscreen__line">{summary.line}</span>}
        </>
      )}
    </div>
  );
}
