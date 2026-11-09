/**
 * The translation the MAIN window's Bible pane is on, as last reported to a popped-out window.
 *
 * A pop-out (notes, ...) has no Bible pane, so `getActiveTranslation()` found no panel there and the
 * notes editor refused to expand a reference ("Open a Bible translation first."). `appearanceSync`
 * fills this from the main window and keeps it live; null means main has none (the refusal stays).
 */
let value: string | null = null;

export function getMainActiveTranslation(): string | null {
  return value;
}

export function setMainActiveTranslation(next: string | null | undefined): void {
  value = typeof next === 'string' && next ? next : null;
}
