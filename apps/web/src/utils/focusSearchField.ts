/**
 * Focus (and usually select) the header search field.
 *
 * The field is reached through the DOM rather than a ref because the callers
 * are spread across the app — a global key handler in `useAppShared`, the
 * shortcut chip inside `Header` — and threading a ref to all of them buys
 * nothing over one query against a class the header already owns.
 *
 * `select` defaults to true: every entry point that focuses this field does so
 * because the user wants to type a *new* query. Landing the caret in the middle
 * of the previous one — which is what plain `.focus()` does — means pressing
 * `/` and typing silently appends to the old search instead of replacing it.
 */
export function focusSearchField(options: { select?: boolean } = {}): boolean {
  const { select = true } = options;
  const input = document.querySelector<HTMLInputElement>('.header__search-field');
  if (!input) return false;
  input.focus();
  if (select) input.select();
  return true;
}
