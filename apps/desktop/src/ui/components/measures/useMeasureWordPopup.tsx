/**
 * Weights, measures and money popups on the desktop Bible text (task 0069).
 *
 * `useMeasureWordPopup(tabId)` returns event props to spread on the verse-list
 * container (event delegation: Standard, Reading and Study all render the same
 * `.word[data-word-index]` spans inside `[data-verse-id]`) and the popup element
 * to render. Hover over a marked word opens the popup after ~300 ms; leaving the
 * word and the popup closes it; a click pins it open and is swallowed (so it does
 * not also select the verse) - every other click is untouched. Escape and an
 * outside press close it (Popover).
 *
 * Keyboard: verse words are not focusable on desktop, so there is no keyboard
 * trigger yet; the popup itself is keyboard-operable once pinned (it takes focus).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popover, MeasurePopup, useHoverIntent } from '@bible/ui';
import type { MeasurePopupProps } from '@bible/ui';
import type { MeasurePopupModel } from '@bible/core/browser';
import { useI18n } from '../../contexts/useI18n';
import { useMeasureStore } from '../../stores/useMeasureStore';
import { isTextSelectionActive } from '../../utils/selectionUtils';
import { isInterlinearOriginalTarget } from './badgeHit';
import { useDirection } from '../../contexts/useDirection';
import { measureWordAt, type MeasureWordHit } from './measureWordTarget';

interface OpenPopup {
  key: string;
  models: MeasurePopupModel[];
  rect: { left: number; top: number; right: number; bottom: number };
  pinned: boolean;
}

const MAX_STACKED = 3;

function hitKey(hit: MeasureWordHit): string {
  return `${hit.verseId}:${hit.wordIndex}`;
}

function openFrom(hit: MeasureWordHit, pinned: boolean): OpenPopup {
  const r = hit.element.getBoundingClientRect();
  // rtl-physical: a copy of a measured viewport rect, not a directional offset
  return { key: hitKey(hit), models: hit.models.slice(0, MAX_STACKED), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, pinned };
}

export function openMeasureSettings(): void {
  window.dispatchEvent(new CustomEvent('open-preferences-measures'));
}

export interface MeasureWordPopupApi {
  containerProps: {
    onMouseOver: (e: React.MouseEvent) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseOut: (e: React.MouseEvent) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
  popup: React.ReactNode;
}

export function useMeasureWordPopup(tabId: string | undefined): MeasureWordPopupApi {
  const { t } = useI18n();
  const [open, setOpen] = useState<OpenPopup | null>(null);
  const openRef = useRef<OpenPopup | null>(null);
  openRef.current = open;

  const intent = useHoverIntent<OpenPopup>({
    onShow: (next) => setOpen((cur) => (cur?.pinned ? cur : next)),
    onHide: () => setOpen((cur) => (cur?.pinned ? cur : null)),
  });

  const chapterOf = useCallback(
    () => (tabId ? useMeasureStore.getState().chapters[tabId] : undefined), // allow-getstate: event-time read
    [tabId],
  );

  // The word whose show is pending, so mouse moves inside it do not restart the 300 ms timer.
  const pendingKey = useRef<string | null>(null);

  const onMouseOver = useCallback((e: React.MouseEvent) => {
    const hit = measureWordAt(e.target, chapterOf(), { x: e.clientX, y: e.clientY });
    if (!hit) { pendingKey.current = null; return; }
    const key = hitKey(hit);
    if (openRef.current?.key === key) { intent.cancelHide(); return; }
    if (pendingKey.current === key) return;
    pendingKey.current = key;
    intent.scheduleShow(openFrom(hit, false));
  }, [chapterOf, intent]);

  // Also on move: the badge of a verse-fallback word shares its element with the text.
  const onMouseMove = onMouseOver;

  const onMouseOut = useCallback((e: React.MouseEvent) => {
    const hit = measureWordAt(e.target, chapterOf());
    if (!hit) return;
    const related = measureWordAt(e.relatedTarget, chapterOf());
    if (related && hitKey(related) === hitKey(hit)) return; // still inside the same word
    pendingKey.current = null;
    intent.scheduleHide();
  }, [chapterOf, intent]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTextSelectionActive()) return; // the end of a drag-select keeps its ordinary behaviour
    if (isInterlinearOriginalTarget(e.target)) return; // original-language and Strong's elements keep their own clicks
    const hit = measureWordAt(e.target, chapterOf(), { x: e.clientX, y: e.clientY });
    if (!hit) return;
    e.stopPropagation(); // pins the popup instead of selecting the verse
    intent.cancelHide();
    setOpen(openFrom(hit, true));
  }, [chapterOf, intent]);

  // A new chapter (or recomputed marks) for this tab invalidates a pinned popup.
  const chapterData = useMeasureStore((st) => (tabId ? st.chapters[tabId] : undefined));
  useEffect(() => { intent.hideNow(); setOpen(null); }, [chapterData]); // eslint-disable-line react-hooks/exhaustive-deps

  const dir = useDirection();

  const close = useCallback(() => { intent.hideNow(); setOpen(null); }, [intent]);

  const labels = useMemo<NonNullable<MeasurePopupProps['labels']>>(() => ({
    range: t('measures.popup.range'),
    rangeHint: t('measures.popup.rangeHint'),
    verseNote: t('measures.popup.verseNote'),
    usage: { illustrative: t('measures.popup.usage.illustrative'), figurative: t('measures.popup.usage.figurative') },
    usageHint: { illustrative: t('measures.popup.usageHint.illustrative'), figurative: t('measures.popup.usageHint.figurative') },
    draft: t('measures.popup.draft'),
    sources: t('measures.popup.sources'),
    units: t('measures.popup.units'),
  }), [t]);

  const popup = open ? (
    <Popover
      open
      anchor={open.rect}
      onClose={close}
      width={340}
      role="dialog"
      label={open.models[0]?.title}
      autoFocus={open.pinned}
      onMouseEnter={intent.cancelHide}
      onMouseLeave={() => { if (!openRef.current?.pinned) intent.scheduleHide(); }}
    >
      <div className="flex flex-col gap-3">
        {open.models.map((model, i) => (
          <MeasurePopup
            key={model.occurrenceId}
            model={model}
            labels={labels}
            dir={dir}
            onOpenSettings={i === 0 ? () => { close(); openMeasureSettings(); } : undefined}
          />
        ))}
      </div>
    </Popover>
  ) : null;

  return { containerProps: { onMouseOver, onMouseMove, onMouseOut, onClickCapture }, popup };
}
