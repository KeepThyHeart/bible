/**
 * List actions for My verses: create, rename, delete, and the focus (which list
 * Today follows). Moved from the old Manage Passages screen with its safeguards:
 * the only list cannot be deleted; deleting a list with verses asks where they
 * go; a list with practice history also asks for its name to be typed.
 */

import type { ListSummary } from '../core/types';
import { button, el, focusQuietly, replace } from './dom';
import { errorBanner } from './components';
import type { MenuItem } from './components';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { showModal } from './verseActions';

function failure(host: PanelHost, message: string): void {
  (host.fail ?? host.announce).call(host, message);
}

/** A name dialog (create or rename). `run` returns an error string, or null on success. */
function nameDialog(
  host: PanelHost,
  opts: { title: string; label: string; initial: string; submitLabel: string; run: (name: string) => Promise<string | null> },
): void {
  const input = el('input', {
    class: 'sm-input',
    id: 'sm-list-name',
    type: 'text',
    attrs: { autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done' },
  }) as HTMLInputElement;
  input.value = opts.initial;
  const errorSlot = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });

  const submit = (): void => {
    const name = input.value.trim();
    if (!name) {
      replace(errorSlot, [errorBanner(tr('memory.ui.verses.listNeedsName', 'A list needs a name.'))]);
      focusQuietly(input);
      return;
    }
    save.disabled = true;
    void opts.run(name).then((error) => {
      if (error === null) {
        handle.close();
        return;
      }
      save.disabled = false;
      replace(errorSlot, [errorBanner(error)]);
      focusQuietly(input);
    });
  };
  const save = button(opts.submitLabel, submit, { class: 'sm-btn sm-btn-primary' });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  const handle = showModal(host, {
    title: opts.title,
    body: [el('label', { class: 'sm-label', text: opts.label, attrs: { for: 'sm-list-name' } }), input, errorSlot],
    actions: [button(tr('memory.ui.verses.cancel', 'Cancel'), () => handle.close(), { class: 'sm-btn sm-btn-quiet' }), save],
  });
  focusQuietly(input);
}

export function createList(host: PanelHost): void {
  nameDialog(host, {
    title: tr('memory.ui.verses.newListTitle', 'New list'),
    label: tr('memory.ui.verses.newListLabel', 'List name'),
    initial: '',
    submitLabel: tr('memory.ui.verses.create', 'Create'),
    run: async (name) => {
      const reply = await host.request({ type: 'createList', name });
      if (!reply.ok) return reply.error;
      host.announce(tr('memory.ui.verses.createdName', 'Created {name}.', { name }));
      host.reload();
      return null;
    },
  });
}

export function renameList(host: PanelHost, list: ListSummary): void {
  nameDialog(host, {
    title: tr('memory.ui.verses.renameTitle', 'Rename {name}', { name: list.name }),
    label: tr('memory.ui.verses.newListLabel', 'List name'),
    initial: list.name,
    submitLabel: tr('memory.ui.verses.save', 'Save'),
    run: async (name) => {
      const reply = await host.request({ type: 'renameList', id: list.id, name });
      if (!reply.ok) return reply.error;
      host.announce(tr('memory.ui.verses.renamedTo', 'Renamed to {name}.', { name }));
      host.reload();
      return null;
    },
  });
}

/**
 * Deletes a list. The last list is refused before any request. An empty list
 * goes straight away. Otherwise a dialog asks where its verses move (default
 * "Default", else the first other list); if any verse has practice history the
 * list's name must be typed exactly (case-sensitive, untrimmed) first.
 */
export function deleteList(host: PanelHost, list: ListSummary, lists: ListSummary[]): void {
  const others = lists.filter((l) => l.id !== list.id);
  if (others.length === 0) {
    failure(host, tr('memory.ui.verses.cannotDeleteOnlyList', 'You cannot delete your only list.'));
    return;
  }
  const fallback = others.find((l) => l.name === 'Default') ?? others[0]!;

  const doDelete = (moveTo: number): void => {
    void host.request({ type: 'deleteList', id: list.id, movePassagesTo: moveTo }).then((reply) => {
      if (!reply.ok) {
        failure(host, reply.error);
        return;
      }
      host.announce(tr('memory.ui.verses.deletedName', 'Deleted {name}.', { name: list.name }));
      host.reload();
    });
  };

  if (list.passageCount === 0) {
    doDelete(fallback.id);
    return;
  }

  void host.request({ type: 'getListPracticeStats', id: list.id }).then((reply) => {
    if (!reply.ok) {
      failure(host, reply.error);
      return;
    }
    const { practiced, total } = reply.data;
    const needsName = practiced > 0;

    const select = el('select', {
      class: 'sm-input',
      id: 'sm-delete-move-to',
      attrs: { 'aria-label': tr('memory.ui.verses.moveVersesTo', 'Move its verses to') },
    }) as HTMLSelectElement;
    for (const l of others) {
      const o = el('option', { text: l.name, value: String(l.id) });
      if (l.id === fallback.id) o.selected = true;
      select.appendChild(o);
    }

    const confirm = button(
      tr('memory.ui.verses.deleteAndMove', 'Delete and move {count, plural, one {# verse} other {# verses}}', { count: list.passageCount }),
      () => {
        doDelete(Number(select.value));
        handle.close();
      },
      { class: 'sm-btn sm-btn-danger', disabled: needsName },
    );
    const nameInput = el('input', {
      class: 'sm-input sm-delete-confirm',
      placeholder: tr('memory.ui.verses.typeListNameToConfirm', 'Type the list name to confirm'),
      attrs: { 'aria-label': tr('memory.ui.verses.typeNameToConfirmDelete', 'Type "{name}" to confirm deleting it', { name: list.name }), autocomplete: 'off', spellcheck: 'false' },
    }) as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      confirm.disabled = nameInput.value !== list.name;
    });
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !confirm.disabled) {
        event.preventDefault();
        confirm.click();
      }
    });

    const handle = showModal(host, {
      title: tr('memory.ui.verses.deleteNameQuestion', 'Delete "{name}"?', { name: list.name }),
      body: [
        el('p', {
          class: 'sm-hint',
          text: tr(
            'memory.ui.verses.deleteMoveHint',
            'This list has {count, plural, one {# verse. Choose another list to move it to.} other {# verses. Choose another list to move them to.}}',
            { count: list.passageCount },
          ),
        }),
        select,
        ...(needsName
          ? [el('p', {
              class: 'sm-hint',
              attrs: { role: 'alert' },
              text: tr('memory.ui.verses.practiceHistoryWarning', 'You have practiced {practiced} of {total} verses in this list. Their progress moves with them, but please type the list name to confirm.', { practiced, total }),
            }), nameInput]
          : []),
      ],
      actions: [button(tr('memory.ui.verses.cancel', 'Cancel'), () => handle.close(), { class: 'sm-btn sm-btn-quiet' }), confirm],
    });
  });
}

/** Makes Today follow this list (the persisted scope), or clears it back to all lists. */
export function setFocus(host: PanelHost, list: ListSummary | null): Promise<void> {
  return host.request({ type: 'setScope', scope: list ? { kind: 'list', id: list.id } : { kind: 'all' } }).then((reply) => {
    if (!reply.ok) {
      failure(host, reply.error);
      return;
    }
    host.announce(
      list
        ? tr('memory.ui.verses.focusSet', 'Today now follows {name}.', { name: list.name })
        : tr('memory.ui.verses.focusCleared', 'Today now follows all your lists.'),
    );
    host.reload();
  });
}

/** The small menu of a list chip. `focused` = Today currently follows this list. */
export function listMenuItems(host: PanelHost, list: ListSummary, lists: ListSummary[], focused: boolean): MenuItem[] {
  return [
    focused
      ? { label: tr('memory.ui.verses.clearFocus', 'Clear focus'), onClick: () => void setFocus(host, null) }
      : { label: tr('memory.ui.verses.focusOnList', 'Focus Today on this list'), onClick: () => void setFocus(host, list) },
    { label: tr('memory.ui.verses.rename', 'Rename'), onClick: () => renameList(host, list) },
    { label: tr('memory.ui.verses.deleteList', 'Delete'), onClick: () => deleteList(host, list, lists) },
  ];
}
