import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import {
  DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useStore } from '../../../hooks/useStore';
import { describeItem } from '../study/usePresenter';
import { CommandBox, CommandSearchResults } from '../lib/command';
import type { PresentItem } from '../lib/protocol';
import { presentStore } from '../stores/presentStore';
import { ControlMenu } from './control/ControlMenu';
import { StatusRow } from './control/StatusRow';
import { Transport } from './control/Transport';
import { notesStore } from './notes/notesStore';
import type { PlanItem } from './notes/notesStore';
import type { NoteHighlight } from './notes/types';
import { presenterSend, presenterSettled, presenterShow, usePresenterState } from './presenterSink';
import { PlanRow } from './phone/PlanRow';
import { PhoneAddRow, type PickerKind } from './phone/PhoneAddRow';
import { WordSheet } from './phone/WordSheet';
import { moveTarget, newestItem, rangeOnWall } from './phone/planLogic';
import './phone/phone.css';

const ADD_FALLBACK_MS = 2000;

/**
 * Below 760 px. No Notes/Control/Preview tabs and no rich-text editor:
 *  - frozen top: status line, transport, and the Verse / Hymn / Quote buttons.
 *    Choosing one appends it to the end of the plan, shows it, and scrolls to it.
 *  - the plan list scrolls beneath, drag-reorderable by its handle, the item on
 *    screen in green, each verse's highlight phrases as chips under it.
 *  - the command line pinned at the bottom, search results in a sheet above it.
 * `onAddToNotes` is accepted for the shell's sake but unused: adding here always
 * goes to the end of the plan through `notesStore.addItem`.
 */
export function PhoneLayout(props: {
  onOpenHelp: () => void;
  onAddToNotes?: (item: PresentItem, label?: string) => void;
}) {
  const { t } = useTranslation();
  const state = usePresenterState();
  const session = useStore(presentStore, () => presentStore.session);
  const planItems: PlanItem[] = useStore(notesStore, () => notesStore.planItems) ?? [];
  const liveId = useStore(notesStore, () => notesStore.livePlanItemId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const removed = useStore(notesStore, () => notesStore.removed);
  const listRef = useRef<HTMLUListElement>(null);
  const pending = useRef<{ ids: Set<string>; item: PresentItem; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    notesStore.setTranslate((key, params) => t(key, params) as string);
    void notesStore.init();
  }, [t]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Handle-only (the listeners sit on the handle) and no long-press: a short drag starts it.
    useSensor(TouchSensor, { activationConstraint: { distance: 4 } }),
  );

  const scrollTo = (id: string): void => {
    const el = listRef.current?.querySelector(`[data-plan-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // An added item reaches the plan once detection has run: show it and scroll to it then.
  useEffect(() => {
    const wait = pending.current;
    if (!wait) return;
    const added = newestItem(wait.ids, planItems);
    if (!added) return;
    clearTimeout(wait.timer);
    pending.current = null;
    notesStore.showPlanItem(added.id);
    requestAnimationFrame(() => scrollTo(added.id));
  });
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current.timer);
  }, []);

  const addToPlan = (item: PresentItem, label?: string): void => {
    setPicker(null);
    if (pending.current) clearTimeout(pending.current.timer);
    // If detection never yields a plan entry for it, at least put it on screen.
    const timer = setTimeout(() => {
      if (pending.current) { pending.current = null; presenterShow(item); }
    }, ADD_FALLBACK_MS);
    pending.current = { ids: new Set(planItems.map(p => p.id)), item, timer };
    notesStore.addItem(item, label ?? describeItem(item, 0) ?? t('present.untitledItem'));
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const to = planItems.findIndex(p => p.id === over.id);
    if (to >= 0) notesStore.moveItem(String(active.id), to);
  };

  const onChip = (entry: PlanItem, highlight: NoteHighlight): void => {
    if (!highlight.range) return;
    const isLive = liveId === entry.id;
    // The verse has to be on screen for its highlight to mean anything.
    if (!isLive) notesStore.showPlanItem(entry.id);
    const on = isLive && rangeOnWall(highlight.range, state?.position.highlights ?? []);
    const intent = { type: on ? 'removeHighlight' : 'addHighlight', highlight: highlight.range } as const;
    // Live POSTs are not serialized and `show` clears highlights: wait for the show first.
    if (isLive) void presenterSend(intent);
    else void presenterSettled().then(() => presenterSend(intent));
  };

  const editingEntry = editing ? planItems.find(p => p.id === editing) : undefined;

  return (
    <div class="pz-phone pzp-root" aria-label={t('present.app.phoneLabel')}>
      <div class="pzp-top">
        <div class="pz-control__top pzp-status">
          <StatusRow menuOpen={menuOpen} onToggleMenu={() => setMenuOpen(open => !open)} />
          {menuOpen && <ControlMenu session={session} onClose={() => setMenuOpen(false)} onOpenHelp={props.onOpenHelp} />}
        </div>
        <div class="pzp-controls">
          <Transport />
          <PhoneAddRow open={picker} onOpen={setPicker} onAdd={addToPlan} />
        </div>
      </div>

      <div class="pzp-list">
        {planItems.length === 0 ? (
          <p class="pz-hint pzp-empty">{t('present.phone.empty')}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={planItems.map(p => p.id)} strategy={verticalListSortingStrategy}>
              <ul class="pzp-plan" ref={listRef} aria-label={t('present.phone.planLabel')}>
                {planItems.map((entry, index) => (
                  <PlanRow
                    key={entry.id}
                    entry={entry}
                    index={index}
                    count={planItems.length}
                    live={liveId === entry.id}
                    wallHighlights={state?.position.highlights ?? []}
                    onShow={() => notesStore.showPlanItem(entry.id)}
                    onRemove={() => notesStore.removeItem(entry.id)}
                    onMove={dir => {
                      const to = moveTarget(index, dir, planItems.length);
                      if (to !== null) notesStore.moveItem(entry.id, to);
                    }}
                    onEdit={() => setEditing(entry.id)}
                    onChip={h => onChip(entry, h)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {removed && (
        <div class="pzp-snack" role="status">
          <span>{t('present.phone.removed', { label: removed.label })}</span>
          <button type="button" onClick={() => notesStore.undoRemove()}>{t('present.phone.undo')}</button>
        </div>
      )}

      <div class="pzp-bottom">
        <div class="pzp-results">
          <CommandSearchResults variant="banner" sink={presenterSend} state={state} onAddToNotes={addToPlan} />
        </div>
        <CommandBox variant="bar" searchEnabled sink={presenterSend} state={state} onHelp={props.onOpenHelp} />
      </div>

      {editingEntry && <WordSheet entry={editingEntry} onClose={() => setEditing(null)} />}
    </div>
  );
}
