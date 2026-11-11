/**
 * Verse actions shared by the "..." menu of a My verses row (A6) and the verse
 * page (A7): practice, open, show in Bible, move to another list, remove.
 *
 * STABLE SIGNATURES (the verse page imports these; do not change them):
 *
 *   removeVerse(host: PanelHost, pv: PassageView, onDone: () => void): void
 *     Asks first (a small dialog), then removes. History is kept 7 days and
 *     adding the verse again restores it; the dialog says so when the verse has
 *     history. On success it announces, tells the nav (`passageRemoved`, so a
 *     verse page on this id falls back to My verses) and calls `onDone`.
 *     Nothing happens on cancel.
 *
 *   moveVerseMenuItems(host: PanelHost, pv: PassageView, lists: ListSummary[]): MenuItem[]
 *     One item "Move to {name}" per OTHER list; empty when there is no other
 *     list. Choosing one sends `movePassage`, announces, and reloads.
 *
 *   verseMenuItems(host: PanelHost, pv: PassageView, lists: ListSummary[], opts: VerseMenuOpts): MenuItem[]
 *     The whole menu, in this order: opts.before, Practice now (opts.practice),
 *     Open verse (opts.open), Show in Bible (unless opts.showInBible === false),
 *     the move items, then Remove (calls removeVerse with opts.onRemoved).
 *
 * Also exported: `practiceVerse(host, pv)` and `showModal(host, opts)`.
 */

import type { ListSummary, PassageView } from '../core/types';
import { verseStatus } from '../core/today';
import { button, el } from './dom';
import { modal } from './components';
import type { MenuItem, ModalHandle, ModalOptions } from './components';
import type { PanelHost } from './host';
import { tr } from './i18n';

export interface VerseMenuOpts {
  /** Runs after the verse was removed (A6: reload; the verse page relies on passageRemoved to go back where it was opened). */
  onRemoved: () => void;
  /** Include "Practice now" (A6 yes; the verse page has its own big button). */
  practice?: boolean;
  /** Include "Open verse" (goVerse). */
  open?: boolean;
  /** Include "Show in Bible". Default true. */
  showInBible?: boolean;
  /** Items placed first (the verse page's answer mode and Reset progress). */
  before?: MenuItem[];
}

/** Builds a modal, mounts it inside the app root (so scoped CSS applies), opens it, removes it on close. */
export function showModal(host: PanelHost, opts: ModalOptions): ModalHandle {
  const onClose = opts.onClose;
  const handle: ModalHandle = modal({
    ...opts,
    onClose: () => {
      handle.element.remove();
      onClose?.();
    },
  });
  (host.overlayRoot ?? document.body).appendChild(handle.element);
  handle.open();
  return handle;
}

/** Starts the verse as a one-verse practice (flow `verse`). */
export function practiceVerse(host: PanelHost, pv: PassageView): void {
  void host.startSession(pv.passage.id);
}

export function removeVerse(host: PanelHost, pv: PassageView, onDone: () => void): void {
  const reference = pv.passage.reference;
  const hasHistory = verseStatus(pv, host.now()).status !== 'new';

  const errorSlot = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });
  const confirm = button(
    tr('memory.ui.verses.removeYes', 'Remove'),
    () => {
      confirm.disabled = true;
      void host.request({ type: 'removePassage', passageId: pv.passage.id }).then((reply) => {
        if (!reply.ok) {
          confirm.disabled = false;
          errorSlot.textContent = reply.error;
          errorSlot.setAttribute('role', 'alert');
          return;
        }
        handle.close();
        host.announce(
          hasHistory
            ? tr('memory.ui.verses.removedWithHistory', 'Removed {reference}. Add it again within 7 days to get its progress back.', { reference })
            : tr('memory.ui.verses.removed', 'Removed {reference}.', { reference }),
        );
        host.go({ type: 'passageRemoved', passageId: pv.passage.id });
        onDone();
      });
    },
    { class: 'sm-btn sm-btn-danger' },
  );
  const cancel = button(tr('memory.ui.verses.cancel', 'Cancel'), () => handle.close(), { class: 'sm-btn sm-btn-quiet' });

  const handle = showModal(host, {
    title: tr('memory.ui.verses.removeTitle', 'Remove {reference}?', { reference }),
    body: [
      el('p', {
        class: 'sm-hint',
        attrs: { role: 'alert' },
        text: hasHistory
          ? tr('memory.ui.verses.removeConfirm', 'Its progress is kept for 7 days. If you add it again in that time, you get the progress back.')
          : tr('memory.ui.verses.removeConfirmNew', 'It will be taken off your list.'),
      }),
      errorSlot,
    ],
    actions: [cancel, confirm],
  });
}

export function moveVerseMenuItems(host: PanelHost, pv: PassageView, lists: ListSummary[]): MenuItem[] {
  return lists
    .filter((l) => l.id !== pv.passage.collectionId)
    .map((l) => ({
      label: tr('memory.ui.verses.moveTo', 'Move to {name}', { name: l.name }),
      onClick: () => {
        void host.request({ type: 'movePassage', passageId: pv.passage.id, collectionId: l.id }).then((reply) => {
          if (!reply.ok) {
            (host.fail ?? host.announce).call(host, reply.error);
            return;
          }
          host.announce(tr('memory.ui.verses.moved', 'Moved {reference} to {name}.', { reference: pv.passage.reference, name: l.name }));
          host.reload();
        });
      },
    }));
}

export function verseMenuItems(host: PanelHost, pv: PassageView, lists: ListSummary[], opts: VerseMenuOpts): MenuItem[] {
  const items: MenuItem[] = [...(opts.before ?? [])];
  if (opts.practice) {
    items.push({ label: tr('memory.ui.verses.practiceNow', 'Practice now'), onClick: () => practiceVerse(host, pv) });
  }
  if (opts.open) {
    items.push({
      label: tr('memory.ui.verses.openVerse', 'Open verse'),
      onClick: () => host.go({ type: 'goVerse', passageId: pv.passage.id }),
    });
  }
  if (opts.showInBible !== false) {
    items.push({
      label: tr('memory.ui.verses.showInBible', 'Show in Bible'),
      onClick: () => host.openInBible(pv.passage.startVerseId),
    });
  }
  items.push(...moveVerseMenuItems(host, pv, lists));
  items.push({
    label: tr('memory.ui.verses.remove', 'Remove'),
    onClick: () => removeVerse(host, pv, opts.onRemoved),
  });
  return items;
}
