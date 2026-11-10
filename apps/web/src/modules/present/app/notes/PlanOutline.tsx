import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../../../../hooks/useStore';
import { focusCommandBox } from '../../lib/command';
import { focusFirstMenuItem, handleMenuKey, useExclusiveMenu } from '../../lib/menuKeys';
import { notesStore, type PlanItem } from './notesStore';

/**
 * The Plan view: just the plannable items of the notes, in order. Dragging
 * the handle moves the item's whole section of the notes; Remove unlinks the
 * text (never deletes it) and offers Undo for a few seconds. The list is
 * derived from the notes on every change, so there is nothing to keep in sync.
 */

function PlanCard(props: { p: PlanItem; index: number; count: number; live: boolean; onRemove: (index: number) => void }) {
  const { t } = useTranslation();
  const { p } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  /** Set after Move up/down: the row re-renders at its new index, and focus follows it there. */
  const refocus = useRef(false);

  useExclusiveMenu(`plan-${p.id}`, menu, () => setMenu(false));

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (menu) focusFirstMenuItem(popupRef.current);
  }, [menu]);

  // A move re-renders this row at a new index (the browser drops focus when the node is moved): put it back.
  useEffect(() => {
    if (refocus.current) moreRef.current?.focus();
  }, [props.index]);

  const closeToButton = () => {
    setMenu(false);
    moreRef.current?.focus();
  };

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined } as preact.JSX.CSSProperties;
  const amber = p.status === 'choose';
  const reason = amber && p.reason ? (t(p.reason.key, p.reason.params as Record<string, string | number>) as string) : undefined;
  const run = (fn: () => void, keepFocus = false) => () => {
    setMenu(false);
    if (keepFocus) {
      refocus.current = true;
      setTimeout(() => { refocus.current = false; }, 1500);
    }
    fn();
    if (keepFocus) moreRef.current?.focus();
  };
  const moreLabel = t('present.notes.plan.moreFor', { label: p.label, defaultValue: `${t('present.notes.plan.more')} - ${p.label}` }) as string;
  const reorderLabel = t('present.notes.plan.reorderFor', { label: p.label, defaultValue: `${t('present.notes.plan.reorder')} - ${p.label}` }) as string;

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
        {...(attributes as unknown as Record<string, unknown>)}
        {...(listeners as unknown as Record<string, unknown>)}
        // Pointer-only: keyboard users reorder with Move up / Move down in the row's menu.
        tabIndex={-1}
        aria-hidden="true"
        aria-label={reorderLabel}
        role={undefined}
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
          ref={moreRef}
          aria-label={moreLabel}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
        >
          <i class="fa-solid fa-ellipsis" aria-hidden="true" />
        </button>
        {menu && (
          <div class="pn-plan__menu" role="menu" ref={popupRef} aria-label={moreLabel} onKeyDown={(e) => handleMenuKey(e, popupRef.current, closeToButton)}>
            <button type="button" role="menuitem" disabled={props.index === 0} onClick={run(() => notesStore.moveItem(p.id, props.index - 1), true)}>
              {t('present.notes.plan.moveUp')}
            </button>
            <button type="button" role="menuitem" disabled={props.index === props.count - 1} onClick={run(() => notesStore.moveItem(p.id, props.index + 1), true)}>
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
            <button type="button" role="menuitem" class="is-danger" onClick={run(() => props.onRemove(props.index))}>
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
  const listRef = useRef<HTMLOListElement>(null);
  const addWrapRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  /** After Remove: where focus goes once the row has gone (the next row's More actions, else Add). */
  const afterRemove = useRef<{ index: number; count: number } | null>(null);

  useEffect(() => {
    const pending = afterRemove.current;
    if (!pending || items.length >= pending.count) return;
    afterRemove.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLElement>('.pn-plan__more');
    const target = buttons && buttons.length > 0 ? buttons[Math.min(pending.index, buttons.length - 1)] : document.querySelector<HTMLElement>('.pn-plan__add-btn');
    target?.focus();
  }, [items]);

  // The Add disclosure collapses on an outside press (focus stays where the press put it).
  useEffect(() => {
    if (!adding) return undefined;
    const away = (event: Event): void => {
      if (addWrapRef.current && !addWrapRef.current.contains(event.target as Node)) setAdding(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [adding]);

  const remove = (index: number) => {
    afterRemove.current = { index, count: items.length };
    notesStore.removeItem(items[index].id);
  };
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
            <ol class="pn-plan__list" ref={listRef}>
              {items.map((p, index) => (
                <PlanCard key={p.id} p={p} index={index} count={items.length} live={p.id === live} onRemove={remove} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <div
        class="pn-plan__add"
        ref={addWrapRef}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== 'Escape' || !adding) return;
          event.preventDefault();
          event.stopPropagation();
          setAdding(false);
          addBtnRef.current?.focus();
        }}
      >
        <button type="button" class="pn-plan__add-btn" ref={addBtnRef} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
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
          <button
            type="button"
            onClick={() => {
              notesStore.undoRemove();
              document.querySelector<HTMLElement>('.pn-plan__add-btn')?.focus();
            }}
          >
            {t('present.notes.plan.undo')}
          </button>
        </div>
      )}
    </div>
  );
}
