/**
 * The "Add verse" dialog of My verses and Lists (design-r2 section 2c).
 *
 * The verse selector comes through `host.verseSelector` (a port the host injects), with a live preview from
 * `previewVerses`. Without a port a typed reference field is used (no preview: a reference cannot be turned
 * into verse ids on this side). List preselection: the list the dialog was opened for, then the last chosen
 * list, then the focus, then Default. "Add" adds; "Add and start" adds and starts practice on the new verse.
 */

import type { ListSummary, Passage, PlanView } from '../core/types';
import { button, el, focusQuietly, replace } from './dom';
import { errorBanner } from './components';
import type { PanelHost } from './host';
import { tr, uiLocale } from './i18n';
import { extractReferenceCandidates } from './referenceInput';
import { openBatchModal } from './addVerseForm';
import { showModal } from './verseActions';
import type { VerseSelectionLike, VerseSelectorHandle } from './verseSelectorPort';
import './styles/addDialog.css';

export interface AddVerseDialogOptions {
  /** The lists to offer (from the cached all-scope plan). */
  lists: readonly ListSummary[];
  /** Preselect this list (the Lists tab's selection, or a List filter in My verses). */
  listId?: number | null;
  /** Called after a successful add (the dialog has awaited `host.data.refresh()`). */
  onAdded(passage: Passage): void;
}

const NEW_LIST = 'new';

/** The list to preselect: explicit list, last chosen, focus, Default (the first list). */
export function preselectList(lists: readonly ListSummary[], explicit: number | null | undefined, plan: PlanView | null): number | null {
  const has = (id: unknown): id is number => typeof id === 'number' && lists.some((l) => l.id === id);
  if (has(explicit)) return explicit;
  if (has(plan?.lastAddListId)) return plan!.lastAddListId as number;
  if (has(plan?.focus)) return plan!.focus as number;
  if (has(plan?.collectionId)) return plan!.collectionId;
  return lists[0]?.id ?? null;
}

export function openAddVerseDialog(host: PanelHost, opts: AddVerseDialogOptions): void {
  const { lists } = opts;
  const plan = host.data?.get() ?? null;
  const port = host.verseSelector;

  let selection: VerseSelectionLike | null = null;
  let handle: VerseSelectorHandle | null = null;
  let busy = false;

  // --- reference: the selector, or a typed field ---
  const selectorHost = el('div', { class: 'sm-add-dialog__field' });
  let typed: HTMLInputElement | null = null;
  if (!port) {
    typed = el('input', {
      class: 'sm-add-dialog__control',
      id: 'sm-add-dialog-reference',
      type: 'text',
      placeholder: host.activeReference ?? tr('memory.ui.verses.addPlaceholder', 'e.g. Psalm 23:1-6'),
      attrs: { autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done' },
    }) as HTMLInputElement;
    replace(selectorHost, [
      el('label', { class: 'sm-add-dialog__label', text: tr('memory.addVerse.reference', 'Reference'), attrs: { for: typed.id } }),
      typed,
    ]);
  }

  // --- list picker ---
  const showPicker = lists.length > 1;
  const listSelect = el('select', { class: 'sm-add-dialog__control', id: 'sm-add-dialog-list' }) as HTMLSelectElement;
  for (const l of lists) listSelect.appendChild(el('option', { text: l.name, value: String(l.id) }));
  listSelect.appendChild(el('option', { text: tr('memory.addVerse.newList', 'New list...'), value: NEW_LIST }));
  const pre = preselectList(lists, opts.listId, plan);
  listSelect.value = pre != null ? String(pre) : NEW_LIST;
  const nameInput = el('input', {
    class: 'sm-add-dialog__control',
    id: 'sm-add-dialog-name',
    type: 'text',
    attrs: { autocomplete: 'off' },
  }) as HTMLInputElement;
  const nameField = el('div', { class: 'sm-add-dialog__field' }, [
    el('label', { class: 'sm-add-dialog__label', text: tr('memory.addVerse.newListName', 'New list name'), attrs: { for: nameInput.id } }),
    nameInput,
  ]);
  const syncName = (): void => {
    nameField.hidden = listSelect.value !== NEW_LIST;
  };
  syncName();
  listSelect.addEventListener('change', () => {
    syncName();
    if (listSelect.value === NEW_LIST) focusQuietly(nameInput);
  });

  const errorSlot = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });

  const targetList = (): number | undefined => {
    if (!showPicker && lists.length === 1) return lists[0]!.id;
    return listSelect.value === NEW_LIST ? undefined : Number(listSelect.value);
  };
  const creating = (): boolean => (showPicker || lists.length === 0) && listSelect.value === NEW_LIST;

  const fail = (message: string): void => {
    replace(errorSlot, [errorBanner(message)]);
  };

  async function add(start: boolean): Promise<void> {
    if (busy) return;
    replace(errorSlot, []);
    const newName = nameInput.value.trim();
    if (creating() && newName === '') {
      fail(tr('memory.addVerse.nameEmpty', 'Give the new list a name.'));
      focusQuietly(nameInput);
      return;
    }
    busy = true;
    addBtn.disabled = true;
    startBtn.disabled = true;
    try {
      let passage: Passage | null = null;
      let listName = '';
      if (port) {
        if (!selection) {
          fail(tr('memory.addVerse.chooseVerse', 'Choose a verse first, for example "John 3:16-18".'));
          return;
        }
        const reply = await host.request(
          creating()
            ? { type: 'addPassageRange', startVerseId: selection.verseId, endVerseId: selection.endVerseId ?? selection.verseId, newListName: newName }
            : { type: 'addPassageRange', startVerseId: selection.verseId, endVerseId: selection.endVerseId ?? selection.verseId, collectionId: targetList() },
        );
        if (!reply.ok) return fail(reply.error);
        passage = reply.data.passage;
      } else {
        const candidates = extractReferenceCandidates(typed!.value);
        const references = candidates.length > 0 ? candidates : host.activeReference ? [host.activeReference.trim()] : [];
        if (references.length === 0) {
          fail(tr('memory.ui.verses.typeReferenceFirst', 'Type a reference first, for example "John 3:16-18".'));
          focusQuietly(typed);
          return;
        }
        if (references.length > 1) {
          handleClose();
          openBatchModal(host, targetList, typed!.value, references);
          return;
        }
        let collectionId = targetList();
        if (creating()) {
          const made = await host.request({ type: 'createList', name: newName });
          if (!made.ok) return fail(made.error);
          const found = made.data.lists.find((l) => l.name.toLowerCase() === newName.toLowerCase());
          if (!found) return fail(tr('memory.addVerse.listMissing', 'The new list could not be found.'));
          collectionId = found.id;
        }
        const reply = await host.request({ type: 'addPassage', reference: references[0]!, ...(collectionId === undefined ? {} : { collectionId }) });
        if (!reply.ok) return fail(reply.error);
        passage = reply.data.passage;
      }
      listName =
        lists.find((l) => l.id === passage!.collectionId)?.name ?? (creating() ? newName : '');
      host.announce(
        tr('memory.addVerse.added', 'Added {reference} to {list}.', { reference: passage.reference, list: listName }),
      );
      await host.data?.refresh();
      handleClose();
      opts.onAdded(passage);
      if (start) await host.startSession(passage.id);
    } finally {
      busy = false;
      addBtn.disabled = false;
      startBtn.disabled = false;
    }
  }

  const cancelBtn = button(tr('memory.ui.verses.cancel', 'Cancel'), () => handleClose(), { class: 'sm-btn sm-btn-quiet' });
  const addBtn = button(tr('memory.ui.verses.add', 'Add'), () => void add(false), { class: 'sm-btn sm-btn-primary' });
  const startBtn = button(tr('memory.addVerse.addAndStart', 'Add and start'), () => void add(true), { class: 'sm-btn' });
  const severalBtn = button(
    tr('memory.ui.verses.addSeveral', 'Add several at once'),
    () => {
      handleClose();
      openBatchModal(host, targetList);
    },
    { class: 'sm-btn sm-btn-quiet sm-btn-small sm-link-btn' },
  );

  const body = el('div', { class: 'sm-add-dialog' }, [
    selectorHost,
    showPicker || lists.length === 0
      ? el('div', { class: 'sm-add-dialog__field' }, [
          el('label', { class: 'sm-add-dialog__label', text: tr('memory.ui.verses.addToList', 'Add to list'), attrs: { for: listSelect.id } }),
          listSelect,
        ])
      : null,
    showPicker || lists.length === 0 ? nameField : null,
    errorSlot,
    severalBtn,
  ]);

  const modal = showModal(host, {
    title: tr('memory.addVerse.title', 'Add verse'),
    body: [body],
    actions: [cancelBtn, startBtn, addBtn],
    onClose: () => {
      handle?.dispose();
      handle = null;
    },
  });
  function handleClose(): void {
    modal.close();
  }
  // Escape closes the dialog even with a seeded reference: the picker swallows Escape while its text is non-empty,
  // so listen in the capture phase. An open suggestion list (aria-expanded) still closes first.
  modal.element.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key !== 'Escape') return;
      if ((ev.target as HTMLElement | null)?.getAttribute?.('aria-expanded') === 'true') return;
      ev.preventDefault();
      ev.stopPropagation();
      handleClose();
    },
    true,
  );

  if (port) {
    // The placeholder of the fixed-size preview box (addDialog.css), as a CSS string for `content`.
    selectorHost.style.setProperty(
      '--sm-preview-empty',
      JSON.stringify(tr('memory.addVerse.previewEmpty', 'The verse text appears here.')),
    );
    handle = port.mount(selectorHost, {
      id: 'sm-add-dialog-selector',
      initialReference: host.activeReference ?? undefined,
      autoFocus: true,
      crossChapter: true,
      wholeChapter: true,
      ...(uiLocale() !== undefined ? { locale: uiLocale() } : {}),
      labels: selectorLabels(),
      onChange: (sel) => {
        selection = sel;
      },
      onSubmit: (sel) => {
        selection = sel;
        void add(false);
      },
      lookup: async (range, signal) => {
        const reply = await host.request({
          type: 'previewVerses',
          startVerseId: range.verseId,
          endVerseId: range.endVerseId ?? range.verseId,
        });
        if (signal.aborted || !reply.ok) return null;
        return reply.data.verses.map((v) => ({ verseId: v.verseId, text: v.words.join(' ') }));
      },
    });
  } else if (typed) {
    typed.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault();
        void add(false);
      }
    });
    focusQuietly(typed);
  }
  nameInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      void add(false);
    }
  });
}

/** The verse selector's labels, translated here (Memory owns its strings); `{chapter}`/`{count}` stay for the selector. */
function selectorLabels(): Record<string, string> {
  return {
    group: tr('memory.addVerse.selector.group', 'Verse selector'),
    reference: tr('memory.addVerse.selector.reference', 'Bible reference'),
    placeholder: tr('memory.addVerse.selector.placeholder', 'e.g. John 3:16'),
    book: tr('memory.addVerse.selector.book', 'Book'),
    chapter: tr('memory.addVerse.selector.chapter', 'Chapter'),
    verse: tr('memory.addVerse.selector.verse', 'Verse'),
    to: tr('memory.addVerse.selector.to', 'To verse'),
    all: tr('memory.addVerse.selector.all', 'All'),
    endOfChapter: tr('memory.addVerse.selector.endOfChapter', 'End of chapter {chapter}', { chapter: '{chapter}' }),
    invalid: tr('memory.addVerse.selector.invalid', 'Not a valid reference'),
    crossChapterNotAllowed: tr('memory.addVerse.selector.crossChapterNotAllowed', 'A range cannot span chapters here'),
    preview: tr('memory.addVerse.selector.preview', 'Verse text'),
    loading: tr('memory.addVerse.selector.loading', 'Loading...'),
    unavailable: tr('memory.addVerse.selector.unavailable', 'No text available'),
    more: tr('memory.addVerse.selector.more', 'and {count} more', { count: '{count}' }),
  };
}
