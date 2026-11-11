/**
 * The add-a-verse field of My verses (A6), its list picker (shown when there is
 * more than one list), and the "Add several at once" dialog.
 *
 * Carried over from the old Manage Passages screen with its behaviour intact:
 * pasting several references, confirming a batch first, and consolidating
 * references that overlap inside one batch (`dropContainedRanges`). New:
 * every add names its list (`addPassage.collectionId`), so the user's focus is
 * never switched as a side effect.
 *
 * The input keeps the id `sm-add-reference`; the host pokes that id to show the
 * Bible's current verse as the placeholder.
 */

import type { ListSummary, Passage } from '../core/types';
import { button, el, focusQuietly, replace } from './dom';
import { errorBanner } from './components';
import { dropContainedRanges, extractReferenceCandidates } from './referenceInput';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { showModal } from './verseActions';

export interface BatchOutcome {
  added: Passage[];
  failed: { reference: string; error: string }[];
  dropped: Passage[];
  existing: number;
}

/**
 * Adds references one after another (not in parallel: they become database
 * rows and a race buys nothing), then consolidates the batch's own overlaps
 * ("John 3:16-17 in the batch makes a separate John 3:16 redundant").
 *
 * A repeat, or a reference already in the target list, is not a failure:
 * `addPassage` answers with the existing row, which counts as added.
 * `collectionId` omitted = the worker's default target.
 */
export async function addBatch(host: PanelHost, references: string[], collectionId?: number): Promise<BatchOutcome> {
  const addedPassages: Passage[] = [];
  let existing = 0;
  const failed: { reference: string; error: string }[] = [];

  for (const reference of references) {
    const reply = await host.request(
      collectionId === undefined ? { type: 'addPassage', reference } : { type: 'addPassage', reference, collectionId },
    );
    if (reply.ok) {
      addedPassages.push(reply.data.passage);
      if (reply.data.existed) existing += 1;
    } else failed.push({ reference, error: reply.error });
  }

  // Collapse repeats first, so the range check never mistakes "the same row
  // twice" for "one range containing another" and removes the one to keep.
  const { kept: survivors, dropped: subsumed } = dropContainedRanges(dedupeById(addedPassages));
  const kept = [...survivors];
  const dropped: Passage[] = [];
  for (const passage of subsumed) {
    // If removal itself fails the passage stays counted as kept.
    const reply = await host.request({ type: 'removePassage', passageId: passage.id });
    if (reply.ok) dropped.push(passage);
    else kept.push(passage);
  }

  return { added: kept, failed, dropped, existing };
}

/** Collapses `addPassage` replies to one entry per underlying row, first wins. */
export function dedupeById(passages: Passage[]): Passage[] {
  const byId = new Map<number, Passage>();
  for (const p of passages) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  return [...byId.values()];
}

/** Announces the outcome of an `addBatch`; reloads on any success. */
export function announceBatch(host: PanelHost, outcome: Omit<BatchOutcome, 'existing'> & { existing?: number }): void {
  const { added, failed, dropped } = outcome;
  if (added.length === 0) return;
  if (added.length === 1 && failed.length === 0 && dropped.length === 0 && outcome.existing === 1) {
    host.announce(tr('memory.ui.verses.alreadyInList', '{reference} is already in your list.', { reference: added[0]!.reference }));
    return;
  }
  const mergedNote =
    dropped.length > 0
      ? tr('memory.ui.verses.mergedNote', ' {count, plural, one {# reference is} other {# references are}} already covered by another verse in this batch.', { count: dropped.length })
      : '';
  host.announce(
    added.length === 1 && failed.length === 0 && dropped.length === 0
      ? tr('memory.ui.verses.addedReference', 'Added {reference}.', { reference: added[0]!.reference })
      : failed.length === 0
        ? tr('memory.ui.verses.addedVerses', 'Added {count, plural, one {# verse} other {# verses}}.{note}', { count: added.length, note: mergedNote })
        : tr('memory.ui.verses.addedVersesSomeFailed', 'Added {count, plural, one {# verse} other {# verses}}; {failed} failed.{note}', { count: added.length, failed: failed.length, note: mergedNote }),
  );
  host.reload();
}

/** One failed reference as shown: bare for a lone reference, prefixed when among several. */
function addFailureMessage(references: string[], failure: { reference: string; error: string }): string {
  return references.length === 1 ? failure.error : `${failure.reference}: ${failure.error}`;
}

/**
 * Opens "Add several at once": a textarea plus "Find references", which swaps
 * (inside the dialog) to a confirm list with Back / Add N verses. A non-empty
 * `prefill` is parsed at once and lands on the confirm view; `lines`, when
 * given, are the parsed list. `collectionId()` is read when the add happens, so
 * it follows the list picker.
 */
export function openBatchModal(
  host: PanelHost,
  collectionId: () => number | undefined,
  prefill = '',
  lines?: string[],
): void {
  const textarea = el('textarea', { class: 'sm-textarea', id: 'sm-batch-textarea', attrs: { rows: '8' } }) as HTMLTextAreaElement;
  textarea.value = prefill;
  const body = el('div', { class: 'sm-modal-batch-body' });

  const handle = showModal(host, {
    title: tr('memory.ui.verses.addSeveralTitle', 'Add several verses at once'),
    body: [body],
  });

  function showEntry(): void {
    const errorSlot = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });
    const cancelBtn = button(tr('memory.ui.verses.cancel', 'Cancel'), () => handle.close(), { class: 'sm-btn sm-btn-quiet' });
    const findBtn = button(
      tr('memory.ui.verses.findReferences', 'Find references'),
      () => {
        const candidates = extractReferenceCandidates(textarea.value);
        if (candidates.length === 0) {
          replace(errorSlot, [errorBanner(tr('memory.ui.verses.typeOrPasteFirst', 'Type or paste at least one reference first.'))]);
          focusQuietly(textarea);
          return;
        }
        showConfirm(candidates);
      },
      { class: 'sm-btn sm-btn-primary' },
    );
    replace(body, [
      el('label', { class: 'sm-label', text: tr('memory.ui.verses.references', 'References'), attrs: { for: 'sm-batch-textarea' } }),
      textarea,
      el('p', { class: 'sm-hint', text: tr('memory.ui.verses.pasteReferencesHint', 'Paste a list of references, or any text that has references in it, and they will be found for you.') }),
      errorSlot,
      el('div', { class: 'sm-modal-actions' }, [cancelBtn, findBtn]),
    ]);
    focusQuietly(textarea);
  }

  function showConfirm(confirmLines: string[]): void {
    const errorSlot = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });
    const backBtn = button(tr('memory.ui.verses.back', 'Back'), () => showEntry(), { class: 'sm-btn sm-btn-quiet' });
    const addBtn = button(
      tr('memory.ui.verses.addNVerses', 'Add {count, plural, one {# verse} other {# verses}}', { count: confirmLines.length }),
      () => {
        addBtn.disabled = true;
        backBtn.disabled = true;
        replace(errorSlot, []);
        void addBatch(host, confirmLines, collectionId()).then((outcome) => {
          if (outcome.failed.length === 0) {
            handle.close(); // before announceBatch reloads the screen
            announceBatch(host, outcome);
            return;
          }
          announceBatch(host, outcome);
          addBtn.disabled = false;
          backBtn.disabled = false;
          replace(errorSlot, outcome.failed.map((f) => errorBanner(addFailureMessage(confirmLines, f))));
        });
      },
      { class: 'sm-btn sm-btn-primary' },
    );
    replace(body, [
      el('p', { class: 'sm-hint', text: tr('memory.ui.verses.addNVersesQuestion', 'Add {count, plural, one {# verse} other {# verses}}?', { count: confirmLines.length }) }),
      el('ul', { class: 'sm-batch-list' }, confirmLines.map((line) => el('li', { class: 'sm-batch-list-item', text: line }))),
      errorSlot,
      el('div', { class: 'sm-modal-actions' }, [backBtn, addBtn]),
    ]);
    focusQuietly(addBtn);
  }

  if (lines && lines.length > 0) showConfirm(lines);
  else if (prefill.trim().length > 0) {
    const found = extractReferenceCandidates(prefill);
    if (found.length > 0) showConfirm(found);
    else showEntry();
  } else showEntry();
}

export interface AddVerseFormOptions {
  lists: ListSummary[];
  /** The list preselected in the picker (and used when there is only one list). */
  defaultListId: number;
  /** One verse was added (or was already there). Not called for a batch (announceBatch reloads). */
  onAdded: (passage: Passage, existed: boolean) => void;
}

/**
 * The add field: `[reference] [list picker, only with more than one list] [Add]`
 * and an "Add several at once" button. The error slot is always in the DOM so
 * the rows below do not jump when a reference fails to parse; the worker's own
 * message is shown verbatim (it is the only thing that says what went wrong).
 */
export function renderAddVerseForm(host: PanelHost, opts: AddVerseFormOptions): { element: HTMLElement; openBatch: (lines?: string[]) => void } {
  const input = el('input', {
    class: 'sm-input',
    id: 'sm-add-reference',
    type: 'text',
    placeholder: host.activeReference ?? tr('memory.ui.verses.addPlaceholder', 'e.g. Psalm 23:1-6'),
    attrs: { autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done' },
  }) as HTMLInputElement;
  const errorSlot = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });
  const submit = el('button', { class: 'sm-btn sm-btn-primary', text: tr('memory.ui.verses.add', 'Add') }) as HTMLButtonElement;
  submit.type = 'submit';

  let select: HTMLSelectElement | null = null;
  if (opts.lists.length > 1) {
    select = el('select', {
      class: 'sm-input sm-add-list',
      id: 'sm-add-list',
      attrs: { 'aria-label': tr('memory.ui.verses.addToList', 'Add to list') },
    }) as HTMLSelectElement;
    for (const l of opts.lists) {
      const o = el('option', { text: l.name, value: String(l.id) });
      if (l.id === opts.defaultListId) o.selected = true;
      select.appendChild(o);
    }
  }
  const targetList = (): number => (select ? Number(select.value) : opts.defaultListId);

  const openBatch = (lines?: string[]): void =>
    openBatchModal(host, targetList, lines ? lines.join('\n') : '', lines);

  const form = el('form', { class: 'sm-add sm-verses-add' }, [
    el('label', { class: 'sm-label', text: tr('memory.ui.verses.addAVerse', 'Add a verse'), attrs: { for: 'sm-add-reference' } }),
    el('div', { class: 'sm-add-row' }, [input, select, submit]),
    errorSlot,
    el('p', {
      class: 'sm-hint',
      text: tr('memory.ui.verses.addTranslationHint', 'Add a translation after the reference to use it, e.g. Psalm 23:1-3 ASV. Without one, the last translation you chose here (or your default) is used.'),
    }),
    button(tr('memory.ui.verses.addSeveral', 'Add several at once'), () => openBatch(), {
      class: 'sm-btn sm-btn-quiet sm-btn-small sm-link-btn',
    }),
  ]) as HTMLFormElement;

  async function addReferences(references: string[]): Promise<void> {
    submit.disabled = true;
    input.disabled = true;
    replace(errorSlot, []);
    const outcome = await addBatch(host, references, targetList());
    submit.disabled = false;
    input.disabled = false;
    const { added, failed } = outcome;

    if (failed.length > 0) {
      replace(errorSlot, failed.map((f) => errorBanner(addFailureMessage(references, f))));
      focusQuietly(input);
    }
    if (added.length === 0) return;
    input.value = '';
    if (added.length === 1 && failed.length === 0 && outcome.dropped.length === 0) {
      const passage = added[0]!;
      host.announce(
        outcome.existing === 1
          ? tr('memory.ui.verses.alreadyInList', '{reference} is already in your list.', { reference: passage.reference })
          : tr('memory.ui.verses.addedReference', 'Added {reference}.', { reference: passage.reference }),
      );
      opts.onAdded(passage, outcome.existing === 1);
      return;
    }
    announceBatch(host, outcome);
  }

  input.addEventListener('paste', (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const candidates = extractReferenceCandidates(text);
    if (candidates.length > 1) {
      // Take the paste over: a single-line field can mangle newlines.
      event.preventDefault();
      openBatchModal(host, targetList, text, candidates);
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const candidates = extractReferenceCandidates(input.value);
    // An empty field falls back to the Bible's current verse (the placeholder).
    const references = candidates.length > 0 ? candidates : host.activeReference ? [host.activeReference.trim()] : [];
    if (references.length === 0) {
      replace(errorSlot, [errorBanner(tr('memory.ui.verses.typeReferenceFirst', 'Type a reference first, for example "John 3:16-18".'))]);
      focusQuietly(input);
      return;
    }
    // Typed text can name several references; confirm them first.
    if (references.length > 1) {
      openBatchModal(host, targetList, input.value, references);
      return;
    }
    void addReferences(references);
  });

  return { element: el('div', { class: 'sm-add-wrapper' }, [form]), openBatch };
}
