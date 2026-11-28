/**
 * The reference field with "Add and start": adds the verse (or verses), then
 * starts the first one. Shared by Home (first open) and Practice (empty focus).
 * Keeps the id `sm-add-reference` so the shell can refresh the placeholder when
 * the Bible pane moves to another verse.
 */

import { el, focusQuietly, replace } from './dom';
import { errorBanner } from './components';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { extractReferenceCandidates } from './referenceInput';

export function renderAddAndStart(host: PanelHost): HTMLElement {
  const input = el('input', {
    class: 'sm-input',
    id: 'sm-add-reference',
    type: 'text',
    placeholder: host.activeReference ?? tr('memory.ui.today.addPlaceholder', 'John 3:16 or Psalm 23'),
    attrs: {
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
      enterkeyhint: 'go',
      'aria-label': tr('memory.ui.today.addLabel', 'Verse to memorize'),
    },
  }) as HTMLInputElement;
  const errorSlot = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });
  const submit = el('button', {
    class: 'sm-btn sm-btn-primary',
    text: tr('memory.ui.today.addAndStart', 'Add and start'),
  }) as HTMLButtonElement;
  submit.type = 'submit';

  const form = el('form', { class: 'sm-today-add' }, [
    el('div', { class: 'sm-today-add-row' }, [input, submit]),
    errorSlot,
  ]) as HTMLFormElement;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const typed = extractReferenceCandidates(input.value);
    const refs = typed.length > 0 ? typed : host.activeReference ? [host.activeReference.trim()] : [];
    if (refs.length === 0) {
      replace(errorSlot, [errorBanner(tr('memory.ui.today.typeReferenceFirst', 'Type a reference first, for example "John 3:16-18".'))]);
      focusQuietly(input);
      return;
    }
    void (async () => {
      submit.disabled = true;
      input.disabled = true;
      replace(errorSlot, []);
      let firstId: number | null = null;
      const failures: string[] = [];
      for (const reference of refs) {
        const reply = await host.request({ type: 'addPassage', reference });
        if (reply.ok) {
          if (firstId === null) firstId = reply.data.passage.id;
        } else {
          failures.push(refs.length > 1 ? `${reference}: ${reply.error}` : reply.error);
        }
      }
      submit.disabled = false;
      input.disabled = false;
      if (failures.length > 0) {
        replace(errorSlot, failures.map((f) => errorBanner(f)));
        focusQuietly(input);
      }
      if (firstId !== null) {
        input.value = '';
        await host.startSession(firstId);
      }
    })();
  });
  return form;
}
