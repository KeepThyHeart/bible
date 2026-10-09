import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../../../../hooks/useStore';
import { focusCommandBox } from '../../lib/command';
import { notesStore, type PlanItem } from './notesStore';

/**
 * The Plan view: just the plannable items of the notes, in order. Dragging
 * the handle moves the item's whole section of the notes; Remove unlinks the
 * text (never deletes it) and offers Undo for a few seconds. The list is
 * derived from the notes on every change, so there is nothing to keep in sync.
 */

function PlanCard(props: { p: PlanItem; index: number; count: number; live: boolean }) {
  const { t } = useTranslation();
  const { p } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined } as preact.JSX.CSSProperties;
  const amber = p.status === 'choose';
  const reason = amber && p.reason ? (t(p.reason.key, p.reason.params as Record<string, string | number>) as string) : undefined;
  const run = (fn: () => void) => () => { setMenu(false); fn(); };

  return (
    <li
      ref={setNodeRef}
      style={style}
      class={`pn-plan__card${props.live ? ' is-live' : ''}${amber ? ' is-amber' : ''}`}
      title={reason}
    >
      <button
        type="button"
        class="pn-plan__grip"
        aria-label={t('present.notes.plan.reorder')}
        {...(attributes as unknown as Record<string, unknown>)}
        {...(listeners as unknown as Record<string, unknown>)}
      >
        <i class="fa-solid fa-grip-vertical" aria-hidden="true" />
      </button>
      <button type="button" class="pn-plan__label" disabled={!p.item} onClick={() => notesStore.showPlanItem(p.id)}>
        <span class="pn-plan__ref">{p.label}</span>
        {reason && <span class="pn-plan__reason">{reason}</span>}
        {p.highlights.length > 0 && (
          <span class="pn-plan__hl">{t('present.notes.plan.highlights', { count: p.highlights.length })}</span>
        )}
      </button>
      <div class="pn-plan__menu-wrap" ref={menuRef}>
        <button
          type="button"
          class="pn-plan__more"
          aria-label={t('present.notes.plan.more')}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
        >
          <i class="fa-solid fa-ellipsis" aria-hidden="true" />
        </button>
        {menu && (
          <div class="pn-plan__menu" role="menu">
            <button type="button" role="menuitem" disabled={props.index === 0} onClick={run(() => notesStore.moveItem(p.id, props.index - 1))}>
              {t('present.notes.plan.moveUp')}
            </button>
            <button type="button" role="menuitem" disabled={props.index === props.count - 1} onClick={run(() => notesStore.moveItem(p.id, props.index + 1))}>
              {t('present.notes.plan.moveDown')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                run(() => notesStore.openChooser({ mode: 'item', id: p.id, anchor: rect }))();
              }}
            >
              {t('present.notes.plan.change')}
            </button>
            <button type="button" role="menuitem" class="is-danger" onClick={run(() => notesStore.removeItem(p.id))}>
              {t('present.notes.plan.remove')}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export function PlanOutline() {
  const { t } = useTranslation();
  const items = useStore(notesStore, () => notesStore.planItems);
  const live = useStore(notesStore, () => notesStore.livePlanItemId);
  const removed = useStore(notesStore, () => notesStore.removed);
  const [adding, setAdding] = useState(false);
  // The handle starts a drag at once (no long-press); the rest of the card scrolls.
  const sensors = useSensors(useSensor(PointerSensor));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const to = items.findIndex((i) => i.id === over.id);
    if (to >= 0) notesStore.moveItem(active.id as string, to);
  };

  const add = (kind: 'verse' | 'hymn' | 'quote') => {
    setAdding(false);
    if (kind === 'verse') focusCommandBox();
    else if (kind === 'hymn') notesStore.openChooser({ mode: 'insert', anchor: new DOMRect(window.innerWidth / 3, 120, 0, 0) });
    else notesStore.addQuoteLine();
  };

  return (
    <div class="pn-plan">
      {items.length === 0 ? (
        <p class="pn-plan__empty">{t('present.notes.plan.empty')}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ol class="pn-plan__list">
              {items.map((p, index) => (
                <PlanCard key={p.id} p={p} index={index} count={items.length} live={p.id === live} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <div class="pn-plan__add">
        <button type="button" class="pn-plan__add-btn" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
          <i class="fa-solid fa-plus" aria-hidden="true" /> {t('present.notes.plan.add')}
        </button>
        {adding && (
          <span class="pn-plan__add-choices">
            {(['verse', 'hymn', 'quote'] as const).map((k) => (
              <button key={k} type="button" onClick={() => add(k)}>{t(`present.notes.plan.addKind.${k}`)}</button>
            ))}
          </span>
        )}
      </div>
      {removed && (
        <div class="pn-plan__snack" role="status">
          <span>{t('present.notes.plan.removed', { label: removed.label })}</span>
          <button type="button" onClick={() => notesStore.undoRemove()}>{t('present.notes.plan.undo')}</button>
        </div>
      )}
    </div>
  );
}
