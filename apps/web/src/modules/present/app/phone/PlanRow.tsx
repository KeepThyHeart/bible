import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { NoteHighlight } from '../notes/types';
import type { PlanItem } from '../notes/notesStore';
import { isSwipeLeft, rangeOnWall } from './planLogic';
import type { HighlightRange } from '../../lib/protocol';

export interface PlanRowProps {
  entry: PlanItem;
  index: number;
  count: number;
  live: boolean;
  wallHighlights: readonly HighlightRange[];
  onShow: () => void;
  onRemove: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onEdit: () => void;
  onChip: (highlight: NoteHighlight) => void;
}

const KIND_ICON: Record<string, string> = { passage: 'fa-book-bible', hymn: 'fa-music', quote: 'fa-quote-left', text: 'fa-align-left' };

/**
 * One plan entry: a drag handle, the label (tap to show it), a menu, and, for a
 * verse, its highlight phrases as small chips underneath. Swiping the row left
 * removes it; the menu is the accessible route to the same, plus Move up / down.
 */
export function PlanRow(props: PlanRowProps) {
  const { t } = useTranslation();
  const { entry, live } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [menuOpen]);

  const onTouchStart = (event: TouchEvent): void => {
    const p = event.touches[0];
    touch.current = { x: p.clientX, y: p.clientY };
  };
  const onTouchMove = (event: TouchEvent): void => {
    const start = touch.current;
    if (!start) return;
    const p = event.touches[0];
    const moveX = p.clientX - start.x;
    setDx(isSwipeLeft(moveX, p.clientY - start.y, 8) ? Math.max(moveX, -120) : 0);
  };
  const onTouchEnd = (event: TouchEvent): void => {
    const start = touch.current;
    touch.current = null;
    const p = event.changedTouches[0];
    setDx(0);
    if (start && p && isSwipeLeft(p.clientX - start.x, p.clientY - start.y)) props.onRemove();
  };

  const isPassage = entry.item?.kind === 'passage';
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 5 : undefined,
  } as any;

  return (
    <li ref={setNodeRef} style={style} class="pzp-rowwrap" data-plan-id={entry.id}>
      <div class="pzp-swipehint" aria-hidden="true"><i class="fa-solid fa-trash" /></div>
      <div
        class={`pzp-row ${live ? 'pzp-row--live' : ''} ${entry.status === 'choose' ? 'pzp-row--choose' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div class="pzp-row__main">
          <button
            type="button"
            class="pzp-handle"
            ref={setActivatorNodeRef as any}
            {...(attributes as any)}
            {...(listeners as any)}
            aria-label={t('present.phone.dragHandle', { label: entry.label })}
          >
            <i class="fa-solid fa-grip-lines" aria-hidden="true" />
          </button>
          <button type="button" class="pzp-row__label" onClick={props.onShow} aria-current={live ? 'true' : undefined}>
            <i class={`fa-solid ${KIND_ICON[entry.item?.kind ?? ''] ?? 'fa-circle'}`} aria-hidden="true" />
            <span class="pzp-row__text">{entry.label}</span>
            {live && <span class="pzp-live">{t('present.phone.onScreen')}</span>}
            {entry.status === 'choose' && <i class="fa-solid fa-triangle-exclamation pzp-row__warn" title={entry.reason ? String(t(`present.notes.reason.${entry.reason.key}`, entry.reason.params as any)) : undefined} aria-hidden="true" />}
          </button>
          <div class="pzp-menuwrap" ref={menuRef}>
            <button
              type="button"
              class="pzp-icon"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('present.phone.itemMenu', { label: entry.label })}
              onClick={() => setMenuOpen(open => !open)}
            >
              <i class="fa-solid fa-ellipsis" aria-hidden="true" />
            </button>
            {menuOpen && (
              <div class="pzp-menu" role="menu">
                {isPassage && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onEdit(); }}>
                    <i class="fa-solid fa-highlighter" aria-hidden="true" />{t('present.phone.editVerse')}
                  </button>
                )}
                <button type="button" role="menuitem" disabled={props.index === 0} onClick={() => { setMenuOpen(false); props.onMove('up'); }}>
                  <i class="fa-solid fa-arrow-up" aria-hidden="true" />{t('present.phone.moveUp')}
                </button>
                <button type="button" role="menuitem" disabled={props.index >= props.count - 1} onClick={() => { setMenuOpen(false); props.onMove('down'); }}>
                  <i class="fa-solid fa-arrow-down" aria-hidden="true" />{t('present.phone.moveDown')}
                </button>
                <button type="button" role="menuitem" class="pzp-menu__danger" onClick={() => { setMenuOpen(false); props.onRemove(); }}>
                  <i class="fa-solid fa-trash" aria-hidden="true" />{t('present.phone.remove')}
                </button>
              </div>
            )}
          </div>
        </div>

        {isPassage && entry.highlights.length > 0 && (
          <ul class="pzp-chips" aria-label={t('present.phone.highlights')}>
            {entry.highlights.map(h => {
              const on = live && rangeOnWall(h.range, props.wallHighlights);
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    class={`pzp-chip ${on ? 'pzp-chip--on' : ''}`}
                    disabled={!h.range}
                    aria-pressed={on}
                    title={h.range ? t('present.phone.chipTooltip') : t('present.phone.chipUnmatched')}
                    onClick={() => props.onChip(h)}
                  >
                    {h.text}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </li>
  );
}
