/**
 * Form building blocks for the Settings tab, on the shared `.kth-field` / `.kth-check` / `.kth-select`
 * classes (the same ones `SettingsForm` uses in the desktop Preferences), so Memory's settings line up
 * with the rest of the app: a heading per section, the label above or beside its control, and muted help
 * text under the control it describes. Layout extras live in `styles/settings.css`.
 */

import { el, type Child } from './dom';
import './styles/settings.css';

let seq = 0;
const nextId = (p: string): string => `${p}-${++seq}`;

/** `section.sm-block.sm-settings-section > h2` plus its content. */
export function settingsSection(
  title: string,
  opts: { class?: string; headingId?: string; attrs?: Record<string, string> },
  children: Child[],
): HTMLElement {
  return el('section', { class: `sm-block sm-settings-section${opts.class ? ` ${opts.class}` : ''}`, attrs: opts.attrs ?? {} }, [
    settingsHeading(title, opts.headingId),
    ...children,
  ]);
}

export function settingsHeading(title: string, id?: string): HTMLElement {
  return el('h2', { class: 'sm-block-title sm-settings-heading', text: title, ...(id ? { id } : {}) });
}

/** Muted help text under a control. */
export function hint(text: string, opts: { id?: string; indent?: boolean; attrs?: Record<string, string> } = {}): HTMLElement {
  return el('p', {
    class: `kth-field__hint${opts.indent ? ' sm-settings-indent' : ''}`,
    text,
    ...(opts.id ? { id: opts.id } : {}),
    attrs: opts.attrs ?? {},
  });
}

/** A checkbox with its label beside it and optional help text under the label. */
export function checkField(o: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (input: HTMLInputElement) => void;
  class?: string;
}): { field: HTMLElement; input: HTMLInputElement } {
  const hintId = o.hint ? `${o.id}-hint` : null;
  const input = el('input', {
    id: o.id,
    type: 'checkbox',
    class: 'kth-check__input',
    attrs: hintId ? { 'aria-describedby': hintId } : {},
  }) as HTMLInputElement;
  input.checked = o.checked;
  input.addEventListener('change', () => o.onChange(input));
  const field = el('div', { class: `kth-field sm-settings-check${o.class ? ` ${o.class}` : ''}` }, [
    el('label', { class: 'kth-check', attrs: { for: o.id } }, [input, el('span', { class: 'kth-check__label', text: o.label })]),
    o.hint && hintId ? hint(o.hint, { id: hintId, indent: true }) : null,
  ]);
  return { field, input };
}

export interface RadioOption {
  value: string;
  label: string;
  /** Muted text after the label on the same line, e.g. "(quick)". */
  aside?: string | null;
  id?: string;
}

/** A set of radio buttons under a legend, with optional help text under the set. */
export function radioField(o: {
  legend: string;
  name?: string;
  current: string;
  options: RadioOption[];
  onChange: (value: string) => void;
  hint?: string;
  class?: string;
}): HTMLFieldSetElement {
  const name = o.name ?? nextId('sm-settings-radio');
  return el('fieldset', { class: `sm-settings-fieldset${o.class ? ` ${o.class}` : ''}` }, [
    el('legend', { class: 'sm-settings-legend', text: o.legend }),
    el(
      'div',
      { class: 'sm-settings-options' },
      o.options.map((opt) => {
        const id = opt.id ?? `${name}-${opt.value}`;
        const input = el('input', { id, type: 'radio', class: 'kth-check__input', attrs: { name, value: opt.value } }) as HTMLInputElement;
        input.checked = o.current === opt.value;
        input.addEventListener('change', () => {
          if (input.checked) o.onChange(opt.value);
        });
        return el('label', { class: 'kth-check', attrs: { for: id } }, [
          input,
          el('span', { class: 'kth-check__label' }, [
            opt.label,
            opt.aside ? el('span', { class: 'kth-check__hint', text: ` ${opt.aside}` }) : null,
          ]),
        ]);
      }),
    ),
    o.hint ? hint(o.hint) : null,
  ]) as HTMLFieldSetElement;
}

/** A labelled select, laid out as a label | control row inside `.sm-settings-grid`. */
export function selectField(o: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  current: string;
  onChange: (value: string) => void;
}): HTMLElement {
  const sel = el('select', { class: 'kth-select sm-settings-select', id: o.id }) as HTMLSelectElement;
  for (const opt of o.options) {
    const node = el('option', { value: opt.value, text: opt.label }) as HTMLOptionElement;
    if (opt.value === o.current) node.selected = true;
    sel.appendChild(node);
  }
  sel.addEventListener('change', () => o.onChange(sel.value));
  return el('div', { class: 'sm-settings-row' }, [
    el('label', { class: 'sm-settings-label', attrs: { for: o.id }, text: o.label }),
    sel,
  ]);
}

/** A row of buttons that keeps them at their natural width, at the start edge. */
export function actionsRow(children: Child[], cls = ''): HTMLElement {
  return el('div', { class: `sm-settings-actions${cls ? ` ${cls}` : ''}` }, children);
}
