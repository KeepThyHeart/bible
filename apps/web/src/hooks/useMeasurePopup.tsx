import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { useTranslation } from 'react-i18next';
import { Popover, BottomSheet, MeasurePopup } from '@bible/ui';
import type { ChapterMeasures } from '@bible/core/browser';
import { wordAddress } from '../measures/chapterMeasures';
import { isInterlinearOriginalTarget, isMeasureHit } from '../measures/badgeHit';
import { isMobileLayout } from '../utils/isMobileLayout';

/** Hover must rest on a word this long before the popup opens. */
export const MEASURE_HOVER_DELAY_MS = 300;
/** Grace period for the pointer to travel from the word onto the popup. */
const CLOSE_DELAY_MS = 200;

interface OpenPopup {
  occIds: string[];
  rect: { top: number; left: number; right: number; bottom: number; width: number; height: number };
  pinned: boolean;
}

export interface MeasurePopupBinding {
  /** Spread onto the element that wraps the verses (event delegation). */
  handlers: {
    onPointerOver: (e: PointerEvent) => void;
    onPointerMove: (e: PointerEvent) => void;
    onPointerOut: (e: PointerEvent) => void;
    onClickCapture: (e: MouseEvent) => void;
  };
  popup: ComponentChildren;
}

/**
 * Hover and tap on a marked word open the weights-and-measures popup: an
 * anchored popover on wide layouts, a bottom sheet on phones. A tap or click on
 * a marked word does not also select the verse.
 */
export function useMeasurePopup(
  measures: ChapterMeasures | null,
  onOpenSettings?: (section?: string) => void,
): MeasurePopupBinding {
  const { t } = useTranslation();
  const [open, setOpen] = useState<OpenPopup | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEl = useRef<Element | null>(null);

  const clearTimers = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    hoverTimer.current = null;
    closeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);
  // A new chapter or new settings invalidate whatever was open.
  useEffect(() => { clearTimers(); setOpen(null); }, [measures, clearTimers]);

  const lookup = (target: EventTarget | null, pointer?: { x: number; y: number }) => {
    if (!measures) return null;
    const addr = wordAddress(target);
    if (!addr) return null;
    const occIds = measures.index.at(addr.verseId, addr.wordIndex).filter((id) => measures.models.has(id));
    if (occIds.length === 0) return null;
    // A verse-level fallback sits on the verse's last word: only its badge, not its text, is a hit.
    if (pointer && !isMeasureHit(addr.el, measures.index, occIds, pointer.x, pointer.y)) return null;
    const r = addr.el.getBoundingClientRect();
    const rect = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    return { addr, occIds, rect };
  };

  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen((cur) => (cur && !cur.pinned ? null : cur)), CLOSE_DELAY_MS);
  };

  const hoverIn = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || isMobileLayout()) return;
      const hit = lookup(e.target, { x: e.clientX, y: e.clientY });
      if (!hit) return;
      if (hoverEl.current === hit.addr.el) return;
      hoverEl.current = hit.addr.el;
      clearTimers();
      hoverTimer.current = setTimeout(() => {
        setOpen((cur) => (cur?.pinned ? cur : { occIds: hit.occIds, rect: hit.rect, pinned: false }));
      }, MEASURE_HOVER_DELAY_MS);
  };

  const handlers: MeasurePopupBinding['handlers'] = {
    onPointerOver: hoverIn,
    // Also on move: the badge of a verse-fallback word shares its element with the text.
    onPointerMove: hoverIn,
    onPointerOut: (e) => {
      if (e.pointerType !== 'mouse') return;
      const addr = wordAddress(e.target);
      if (!addr || addr.el !== hoverEl.current) return;
      const into = wordAddress(e.relatedTarget);
      if (into && into.el === addr.el) return;
      hoverEl.current = null;
      if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
      scheduleClose();
    },
    onClickCapture: (e) => {
      const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
      if (sel && !sel.isCollapsed) return; // finishing a text selection, not a tap
      if (isInterlinearOriginalTarget(e.target)) return; // original-language and Strong's elements keep their own clicks
      const hit = lookup(e.target, { x: e.clientX, y: e.clientY });
      if (!hit) return;
      e.stopPropagation();
      clearTimers();
      setOpen({ occIds: hit.occIds, rect: hit.rect, pinned: true });
    },
  };

  const close = () => { clearTimers(); setOpen(null); };
  const models = open && measures ? open.occIds.map((id) => measures.models.get(id)!).filter(Boolean) : [];

  const labels = {
    range: t('measures.popup.range'),
    rangeHint: t('measures.popup.rangeHint'),
    verseNote: t('measures.popup.verseNote'),
    usage: { illustrative: t('measures.popup.usageIllustrative'), figurative: t('measures.popup.usageFigurative') },
    usageHint: {
      illustrative: t('measures.popup.usageHintIllustrative'),
      figurative: t('measures.popup.usageHintFigurative'),
    },
    draft: t('measures.popup.draft'),
    sources: t('measures.popup.sources'),
    units: t('measures.popup.units'),
  };
  const openSettings = onOpenSettings ? () => { close(); onOpenSettings('measures'); } : undefined;

  let popup: ComponentChildren = null;
  if (open && models.length > 0) {
    const phone = isMobileLayout();
    const dir: 'ltr' | 'rtl' = typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
    const body = models.map((model, i) => (
      <MeasurePopup
        key={model.occurrenceId}
        model={model}
        labels={labels}
        compact={phone}
        dir={dir}
        onOpenSettings={i === models.length - 1 ? openSettings : undefined}
      />
    ));
    popup = phone ? (
      <BottomSheet open onClose={close} title={models.map((m) => m.title).join(' · ')}>{body}</BottomSheet>
    ) : (
      <Popover
        open
        anchor={open.rect}
        onClose={close}
        width={340}
        autoFocus={open.pinned}
        label={models[0].title}
        onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }}
        onMouseLeave={() => { if (!open.pinned) scheduleClose(); }}
      >
        {body}
      </Popover>
    );
  }

  return { handlers, popup };
}
