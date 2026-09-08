/**
 * "Is the user typing into something right now?"
 *
 * Single-key shortcuts - the digit keys that pick a passage format, for
 * instance - must not fire while a text field has focus, or typing `John 3:16`
 * into a reference box would silently change the selected format three times
 * and never reach the box. Every such shortcut asks here first.
 *
 * `<select>` counts: a native select uses printable characters for type-ahead,
 * so claiming a digit there would break a control the browser already gave a
 * keyboard behaviour to.
 */

/** Input types that accept free text (and so must keep their keystrokes). */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'email',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    // A missing/unknown `type` is `text` as far as the browser is concerned.
    return TEXT_INPUT_TYPES.has((target.type || 'text').toLowerCase());
  }
  // Any editable region - the note editor itself is one.
  return target.isContentEditable;
}
