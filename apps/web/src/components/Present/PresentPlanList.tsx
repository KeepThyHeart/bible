import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../../hooks/useStore';
import { presentStore } from '../../stores/presentStore';
import type { PresentPlanEntry } from '../../present/protocol';
import { describeItem, usePresenter } from './usePresenter';

/**
 * The running order: the service plan, in the order it will be used.
 *
 * It lives on the session server-side rather than in this browser's storage,
 * and that is the feature. A plan prepared on a desktop on Saturday is there on
 * the phone on Sunday, with no account to sign into -- which is the thing
 * `localStorage` cannot do and the reason an anonymous session is a good enough
 * substitute for a login here.
 *
 * Tapping an entry sends it to the wall. The entries are references, not
 * copies, so the presenter can still wander off-plan freely: nothing here
 * constrains what can be shown, it only saves typing under pressure.
 */

function PlanRow(props: {
  entry: PresentPlanEntry;
  isLive: boolean;
  onSend: () => void;
  onRemove: () => void;
  onNote: (note: string) => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.entry.id });
  const [editingNote, setEditingNote] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  } as preact.JSX.CSSProperties;

  const label = describeItem(props.entry.item, 0) ?? t('present.untitledItem');

  return (
    <li
      ref={setNodeRef}
      style={style}
      class={`present-plan__row ${props.isLive ? 'present-plan__row--live' : ''}`}
    >
      {/*
        A handle rather than a draggable row: every other control in the row is
        a button, and a row that starts a drag when you meant to press Send is
        the sort of thing that only bites in front of people.
      */}
      <button
        type="button"
        class="present-plan__grip"
        aria-label={t('present.reorder')}
        {...(attributes as unknown as Record<string, unknown>)}
        {...(listeners as unknown as Record<string, unknown>)}
      >
        <i class="fa-solid fa-grip-vertical" aria-hidden="true" />
      </button>

      <button type="button" class="present-plan__label" onClick={props.onSend}>
        <span class="present-plan__ref">{label}</span>
        {props.entry.note && !editingNote && (
          <span class="present-plan__note-text">{props.entry.note}</span>
        )}
      </button>

      {editingNote ? (
        <input
          class="present-plan__note-input"
          type="text"
          autoFocus
          defaultValue={props.entry.note ?? ''}
          placeholder={t('present.notePlaceholder')}
          onBlur={event => {
            setEditingNote(false);
            props.onNote((event.target as HTMLInputElement).value.trim());
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            if (event.key === 'Escape') setEditingNote(false);
          }}
        />
      ) : (
        <button
          type="button"
          class="present-plan__icon"
          onClick={() => setEditingNote(true)}
          title={t('present.addNote')}
          aria-label={t('present.addNote')}
        >
          <i class="fa-solid fa-pen" aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        class="present-plan__icon present-plan__icon--remove"
        onClick={props.onRemove}
        title={t('present.removeFromPlan')}
        aria-label={t('present.removeFromPlan')}
      >
        <i class="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </li>
  );
}

export function PresentPlanList() {
  const { t } = useTranslation();
  const plan = useStore(presentStore, () => presentStore.plan);
  const view = usePresenter();
  const live = view.wall?.live ?? null;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // A shorter hold than the tab bar's: this list does not scroll horizontally,
    // so there is no gesture to disambiguate from.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      void presentStore.reorderPlan(active.id as string, over.id as string);
    }
  };

  const isLive = (entry: PresentPlanEntry): boolean => {
    if (!live || live.kind !== entry.item.kind) return false;
    if (live.kind === 'passage' && entry.item.kind === 'passage') {
      return live.module === entry.item.module
        && live.book === entry.item.book
        && live.chapter === entry.item.chapter;
    }
    return false;
  };

  return (
    <div class="present-plan">
      <div class="present-plan__actions">
        <button
          type="button"
          class="present-plan__add"
          disabled={!view.staged}
          onClick={() => view.staged && void presentStore.addToPlan(view.staged.item)}
        >
          <i class="fa-solid fa-plus" aria-hidden="true" />
          {view.staged
            ? t('present.addToPlan', { ref: view.staged.label })
            : t('present.nothingToAdd')}
        </button>
      </div>

      {plan.length === 0 ? (
        <p class="present-plan__empty">{t('present.planEmpty')}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={plan.map(entry => entry.id)} strategy={verticalListSortingStrategy}>
            <ol class="present-plan__list">
              {plan.map(entry => (
                <PlanRow
                  key={entry.id}
                  entry={entry}
                  isLive={isLive(entry)}
                  onSend={() => void presentStore.show(entry.item)}
                  onRemove={() => void presentStore.removeFromPlan(entry.id)}
                  onNote={note => void presentStore.savePlan(
                    plan.map(other => (other.id === entry.id
                      ? { ...other, ...(note ? { note } : { note: undefined }) }
                      : other)),
                  )}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
