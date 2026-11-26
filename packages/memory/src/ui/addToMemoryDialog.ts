/**
 * "Add to Memory" for the reader's context menu (design-r2 section 3), exported as
 * `@bible/memory/add-to-memory`. It is a small lazy chunk: it imports no other UI module, uses only the
 * passed `t` (never the UI's global `tr`) and its own `styles/addDialog.css` tokens.
 *
 * The dialog always opens: pick a list (the last chosen one is preselected) or create one on the spot,
 * then Add (Enter adds too). Escape, the backdrop and Cancel resolve `null`.
 */

import type { AddVersesResult, MemoryApi } from '../core/api';
import type { Translate } from '../core/messages';
import './styles/addDialog.css';

export interface AddToMemoryOptions {
  api: MemoryApi;
  verseIds: readonly number[];
  module?: string;
  t: Translate;
  locale?: string;
  document?: Document;
}

/** What the dialog resolves with when the user added the verses; `null` when cancelled. */
export type AddToMemoryResult = AddVersesResult & { collectionId: number; listName: string };

const NEW_LIST = 'new';
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let dialogIdSeq = 0;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function openAddToMemoryDialog(opts: AddToMemoryOptions): Promise<AddToMemoryResult | null> {
  const { api, verseIds, module, t } = opts;
  const doc = opts.document ?? document;
  const targets = await api.getAddTargets({ verseIds, module });

  dialogIdSeq += 1;
  const uid = `sm-add-dialog-${dialogIdSeq}`;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const reference = targets.reference ?? t('memory.addDialog.theseVerses', 'these verses');
  const title = make('h2', 'sm-add-dialog__title', t('memory.addDialog.title', 'Add {reference} to Memory', { reference }));
  title.id = `${uid}-title`;

  // --- list picker ---
  const select = make('select', 'sm-add-dialog__control');
  select.id = `${uid}-list`;
  const existing = new Set(targets.existingIn);
  const addOption = (value: string, label: string): void => {
    const o = make('option', undefined, label);
    o.value = value;
    select.appendChild(o);
  };
  for (const l of targets.lists) {
    addOption(
      String(l.id),
      existing.has(l.id) ? t('memory.addDialog.alreadyThere', '{name} (already there)', { name: l.name }) : l.name,
    );
  }
  addOption(NEW_LIST, t('memory.addDialog.newList', 'New list...'));
  const preferred = [targets.lastListId, targets.defaultListId].find((id) => id != null && targets.lists.some((l) => l.id === id));
  select.value = preferred != null ? String(preferred) : targets.lists[0] ? String(targets.lists[0].id) : NEW_LIST;
  const listLabel = make('label', 'sm-add-dialog__label', t('memory.addDialog.list', 'List'));
  listLabel.htmlFor = select.id;

  const nameInput = make('input', 'sm-add-dialog__control');
  nameInput.type = 'text';
  nameInput.id = `${uid}-name`;
  nameInput.setAttribute('autocomplete', 'off');
  const nameLabel = make('label', 'sm-add-dialog__label', t('memory.addDialog.newListName', 'New list name'));
  nameLabel.htmlFor = nameInput.id;
  const nameField = make('div', 'sm-add-dialog__field');
  nameField.append(nameLabel, nameInput);

  const error = make('p', 'sm-add-dialog__error');
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const cancelBtn = make('button', 'sm-add-dialog__btn', t('memory.addDialog.cancel', 'Cancel'));
  cancelBtn.type = 'button';
  const addBtn = make('button', 'sm-add-dialog__btn sm-add-dialog__btn--primary', t('memory.addDialog.add', 'Add'));
  addBtn.type = 'button';
  const actions = make('div', 'sm-add-dialog__actions');
  actions.append(cancelBtn, addBtn);

  const listField = make('div', 'sm-add-dialog__field');
  listField.append(listLabel, select);
  const body = make('div', 'sm-add-dialog');
  body.append(title, listField, nameField, error, actions);

  const panel = make('div', 'sm-add-dialog-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', title.id);
  panel.tabIndex = -1;
  panel.appendChild(body);
  const backdrop = make('div', 'sm-add-dialog-backdrop');
  backdrop.appendChild(panel);

  const syncName = (): void => {
    nameField.hidden = select.value !== NEW_LIST;
  };
  syncName();

  const showError = (message: string): void => {
    error.textContent = message;
    error.hidden = false;
  };

  return new Promise<AddToMemoryResult | null>((resolve) => {
    const opener = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    let busy = false;
    let done = false;

    const finish = (result: AddToMemoryResult | null): void => {
      if (done) return;
      done = true;
      doc.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      opener?.focus({ preventScroll: true });
      resolve(result);
    };

    const submit = async (): Promise<void> => {
      if (busy) return;
      error.hidden = true;
      const creating = select.value === NEW_LIST;
      const name = nameInput.value.trim();
      if (creating && name === '') {
        showError(t('memory.addDialog.nameEmpty', 'Give the new list a name.'));
        nameInput.focus({ preventScroll: true });
        return;
      }
      busy = true;
      addBtn.disabled = true;
      try {
        const result = await api.addVerses(
          creating ? { verseIds, module, newListName: name } : { verseIds, module, collectionId: Number(select.value) },
        );
        finish(result);
      } catch (e) {
        busy = false;
        addBtn.disabled = false;
        let message = errorText(e);
        if (creating) {
          // Two steps, not one transaction: the new list may exist now.
          const after = await api.getAddTargets({ verseIds, module }).catch(() => null);
          const kept = after?.lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
          if (kept && !targets.lists.some((l) => l.id === kept.id)) {
            message = t('memory.addDialog.failedListKept', 'The list "{name}" was created, but adding failed: {error}', { name: kept.name, error: message });
          }
        }
        showError(message);
      }
    };

    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish(null);
      } else if (ev.key === 'Enter' && !ev.isComposing) {
        const target = ev.target as HTMLElement | null;
        if (target === cancelBtn || !backdrop.contains(target)) return;
        ev.preventDefault();
        void submit();
      } else if (ev.key === 'Tab') {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.closest('[hidden]'));
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = doc.activeElement;
        if (!backdrop.contains(active)) {
          ev.preventDefault();
          first.focus();
        } else if (ev.shiftKey && active === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && active === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    }

    select.addEventListener('change', () => {
      syncName();
      if (select.value === NEW_LIST) nameInput.focus({ preventScroll: true });
    });
    cancelBtn.addEventListener('click', () => finish(null));
    addBtn.addEventListener('click', () => void submit());
    backdrop.addEventListener('mousedown', (ev) => {
      if (ev.target === backdrop) finish(null);
    });
    doc.addEventListener('keydown', onKey, true);

    doc.body.appendChild(backdrop);
    (select.value === NEW_LIST ? nameInput : select).focus({ preventScroll: true });
  });
}
