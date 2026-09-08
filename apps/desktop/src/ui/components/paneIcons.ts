import type { PanelContentType } from '../stores/useLayoutStore';

/**
 * Glyph for each panel content type.
 *
 * Shared rather than per-component so a type reads the same wherever it is
 * shown: separate sources for the dockview panel header (`DockviewTabRenderer`)
 * and the Books pane's own tab strip (`BookPane`) would let them disagree -
 * the pane marking dictionaries with a tiny "Dict" text badge and books with
 * nothing at all, while the header above it uses the books and
 * magnifying-glass glyphs.
 *
 * Type-only import, so this module has no runtime dependency on the layout store.
 */
export const PANEL_CONTENT_ICONS: Partial<Record<PanelContentType, string>> = {
  bible: '\u{1F4D6}',      // open book
  commentary: '\u{1F4DD}', // memo
  book: '\u{1F4DA}',       // books
  dictionary: '\u{1F50D}', // magnifying glass
  notes: '\u{270F}\uFE0F', // pencil
  prayer: '\u{1F64F}',     // folded hands
  search: '\u{1F50E}',     // right-pointing magnifying glass
  study: '\u{1F4D1}',      // bookmark tabs
  topics: '\u{1F3F7}\uFE0F', // label
  newtab: '+',              // plus sign
};

/** The two module types the Books pane's unified tab strip can hold. */
export const BOOK_PANE_TAB_ICONS: Record<'book' | 'dictionary', string> = {
  book: PANEL_CONTENT_ICONS.book ?? '\u{1F4DA}',
  dictionary: PANEL_CONTENT_ICONS.dictionary ?? '\u{1F50D}',
};

/**
 * Content types whose *panel tab* deliberately carries no icon.
 *
 * Study, Commentary, Topics and Dictionaries are the app's staple study
 * surfaces - the same four the web app renders as plain text buttons in
 * `.right-pane-tabs` (see `apps/web/src/DesktopApp.tsx`). They are always
 * present, always in the same order, and read faster as words than as a row of
 * near-identical glyphs; dropping the icon also buys back horizontal space in
 * a narrow pane. Books keeps its glyph because a Books tab is one of many
 * possible module tabs rather than a fixed landmark.
 *
 * This is a tab-presentation rule, not a change to the icon vocabulary:
 * `PANEL_CONTENT_ICONS` still holds a glyph for every type, so the Books pane's
 * internal tab strip and `LibraryHome` keep marking dictionaries as before.
 */
export const ICONLESS_TAB_CONTENT_TYPES: readonly PanelContentType[] = [
  'study',
  'commentary',
  'topics',
  'dictionary',
];

/**
 * The glyph a *tab* should show for a content type, or `undefined` when that
 * type is deliberately iconless.
 *
 * Covers the dockview panel header and the Books pane's own tab strip. See
 * `ICONLESS_TAB_CONTENT_TYPES` for why four types come back bare here.
 */
export function tabIconFor(contentType: PanelContentType | undefined): string | undefined {
  if (!contentType) return undefined;
  if (ICONLESS_TAB_CONTENT_TYPES.includes(contentType)) return undefined;
  return PANEL_CONTENT_ICONS[contentType];
}

/**
 * The glyph a *chooser tile* should show for a content type - the "+ New Tab"
 * page and the empty-workspace watermark.
 *
 * Deliberately not `tabIconFor`. The iconless rule exists to keep a crowded
 * horizontal tab strip readable, where the four staple study surfaces are
 * fixed landmarks that read faster as words. A chooser is the opposite
 * situation: a grid of equal-weight tiles the user is scanning for the first
 * time, where a tile with no icon reads as unfinished next to seven that have
 * one, and the icon is the fastest thing to recognise. So every type gets its
 * glyph here, from the same vocabulary the tabs draw on.
 */
export function chooserIconFor(contentType: PanelContentType | undefined): string | undefined {
  if (!contentType) return undefined;
  return PANEL_CONTENT_ICONS[contentType];
}
