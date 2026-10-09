import { useTranslation } from 'react-i18next';
import { notesStore } from '../notes/notesStore';
import { presenterSend, presenterState, usePresenterState } from '../presenterSink';
import { buildChips, nextChip, type HighlightChip } from './highlightChips';

/** The live plan item's note highlights as chips, from the current notes and wall. */
export function liveChips(): HighlightChip[] {
  const item = notesStore.planItems.find(p => p.id === notesStore.livePlanItemId);
  if (!item) return [];
  return buildChips(item.highlights, presenterState()?.position.highlights ?? []);
}

/** `H`: reveal the next highlight. Returns false when there was none to reveal. */
export function revealNextHighlight(): boolean {
  const chip = nextChip(liveChips());
  if (!chip?.range) return false;
  presenterSend({ type: 'addHighlight', highlight: chip.range });
  return true;
}

/** `X`: clear every highlight on the wall. */
export function clearWallHighlights(): void {
  presenterSend({ type: 'clearHighlights' });
}

/**
 * The live verse's note highlights (bold text in the notes that matched words
 * of the verse). Nothing shows on the wall until the presenter clicks a chip
 * or presses `H`; `X` clears. A chip that needs a choice shows its reason.
 */
export function HighlightChips() {
  const { t } = useTranslation();
  usePresenterState(); // Re-render as the wall's highlights change.
  const chips = liveChips();
  if (chips.length === 0) return null;
  const next = nextChip(chips);
  const anyShown = chips.some(c => c.shown);

  return (
    <div class="pz-chips" role="group" aria-label={t('present.control.chips')}>
      <span class="pz-chips__label">{t('present.control.chips')}</span>
      {chips.map(chip => {
        const reason = chip.reason ? t(chip.reason.key, chip.reason.params as Record<string, string | number>) : undefined;
        const disabled = chip.status !== 'ok' || !chip.range;
        return (
          <button
            key={chip.id}
            type="button"
            class={`pz-chip ${chip.shown ? 'pz-chip--shown' : ''} ${chip.status === 'choose' ? 'pz-chip--amber' : ''} ${next?.id === chip.id ? 'pz-chip--next' : ''}`}
            disabled={disabled}
            title={reason ?? (chip.status === 'pending' ? t('present.control.chipPending') : t('present.control.chipReveal'))}
            onClick={() => { if (chip.range) presenterSend({ type: 'addHighlight', highlight: chip.range }); }}
          >
            {chip.text}
            {chip.status === 'choose' && reason && <span class="pz-chip__reason">{reason}</span>}
          </button>
        );
      })}
      {anyShown && (
        <button type="button" class="pz-chip pz-chip--clear" onClick={clearWallHighlights} title={t('present.control.chipsClearTip')}>
          <i class="fa-solid fa-xmark" aria-hidden="true" /> {t('present.control.chipsClear')}
        </button>
      )}
    </div>
  );
}
