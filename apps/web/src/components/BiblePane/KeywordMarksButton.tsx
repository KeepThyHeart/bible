import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { KeywordLegend, type LegendRow } from '@bible/ui';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { keywordMarkStore } from '../../stores/keywordMarkStore';
import { useStore } from '../../hooks/useStore';
import { KEYWORD_PANE_ID } from '../../keywordMarks/paneId';
import { directionForLanguage, displayKeywordLabel } from '@bible/core/browser';
import { legendLabels } from './keywordLabels';

const FLASH_MS = 1400;

/** Scroll a matched word into view and flash it. Falls back to the verse when the word has no span. */
function revealOccurrence(verseId: number, start: number): void {
  const verse = document.querySelector(`[data-verse-id="${verseId}"]`);
  const el = verse?.querySelector(`[data-word-index="${start}"]`) ?? verse;
  if (!el) return;
  (el as HTMLElement).scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.classList.add('keyword-flash');
  setTimeout(() => el.classList.remove('keyword-flash'), FLASH_MS);
}

/**
 * The "Keywords" toolbar button: a pressed toggle with an occurrence-count badge that opens the
 * keyword legend panel (rows, stepping). Web offers the built-in sets only, so the panel has no
 * add, edit or manage-sets controls.
 */
export function KeywordMarksButton() {
  const { t } = useTranslation();
  const paneId = KEYWORD_PANE_ID;
  const tab = useStore(bibleStore, () => bibleStore.getActiveTab());
  const enabled = useStore(keywordMarkStore, () => keywordMarkStore.isEnabled(paneId));
  const rows = keywordMarkStore.legend(paneId);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const cursors = useRef(new Map<string, number>());
  const wrapRef = useRef<HTMLDivElement>(null);

  // Outside-click dismissal, registered once with the open flag in a ref (see BibleToolbar's history menu).
  const openRef = useRef(false);
  openRef.current = open;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (openRef.current && wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && openRef.current) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);

  const total = enabled ? rows.filter((r) => !r.hidden).reduce((n, r) => n + r.hits, 0) : 0;
  const bibleModule = moduleStore.getBibleModules().find((m) => m.abbreviation === tab?.moduleAbbr);
  const language = bibleModule?.language_code ?? 'en';
  const dir = directionForLanguage(language);

  if (!tab) return null;

  const mixedSets = new Set(rows.map((x) => x.setId)).size > 1;
  // `fill` is not a LegendRow field, but the legend's swatch reads it off the row.
  const legendRows = rows.map((r) => ({
    id: r.markId, label: r.label, color: r.style.color, line: r.style.line, symbol: r.style.symbol, bold: r.style.bold,
    fill: r.style.fill, count: r.hits, hidden: r.hidden,
    ...(mixedSets ? { setName: r.setName } : {}),
  }) as LegendRow);

  const step = (id: string, dir: 'next' | 'prev') => {
    const occ = keywordMarkStore.occurrencesOf(paneId, id);
    if (occ.length === 0) return;
    const last = cursors.current.get(id);
    const idx = last === undefined ? (dir === 'next' ? 0 : occ.length - 1) : (last + (dir === 'next' ? 1 : -1) + occ.length) % occ.length;
    cursors.current.set(id, idx);
    const o = occ[idx];
    revealOccurrence(o.verseId, o.start);
    const label = displayKeywordLabel(rows.find((r) => r.markId === id)?.label ?? '');
    setAnnouncement(t('keywordMarks.announce', { label, verse: o.verseId % 1000, index: idx + 1, total: occ.length }));
  };

  return (
    <div class="bible-toolbar__keywords" ref={wrapRef}>
      <button
        class={`bible-toolbar__btn bible-toolbar__keywords-btn${enabled ? ' bible-toolbar__keywords-btn--on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={t('keywordMarks.buttonTitle')}
        aria-label={t('keywordMarks.buttonTitle')}
        aria-pressed={enabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="keyword-marks-toggle"
      >
        <i class="fa-solid fa-highlighter" aria-hidden="true" />
        <span class="bible-toolbar__btn-label">{t('keywordMarks.button')}</span>
        {total > 0 && <span class="bible-toolbar__badge" data-testid="keyword-marks-badge">{total}</span>}
      </button>
      {open && (
        <div class="bible-toolbar__keywords-panel">
          <KeywordLegend
            enabled={enabled}
            onToggleEnabled={() => keywordMarkStore.togglePane(paneId)}
            rows={legendRows}
            onToggleRow={(id) => keywordMarkStore.toggleMark(paneId, id)}
            onStep={step}
            interlinearNote={keywordMarkStore.needsInterlinear(paneId) ? t('keywordMarks.interlinearNote') : null}
            announcement={announcement}
            labels={legendLabels(t)}
            dir={dir}
          />
        </div>
      )}
    </div>
  );
}
