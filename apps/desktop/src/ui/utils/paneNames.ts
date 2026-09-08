/**
 * The catalog key for each pane's name, and the rule for turning a dockview
 * panel's stored title into a localized one.
 *
 * ## Why keys and not text
 *
 * A pane name reaches the user from two very different places - the Fonts
 * section of Preferences and the dockview tab strip - and in the second case it
 * is *persisted*: `api.addPanel({ title })` writes the string into the
 * serialized layout, which is restored verbatim on the next launch. Resolving a
 * name to text at creation time therefore does not merely freeze the locale for
 * the current render, it bakes that locale into the saved session. Both call
 * sites resolve `PANE_NAME_KEYS` with `t()` at render time instead, so a locale
 * change re-renders open tabs.
 *
 * ## Bare nouns
 *
 * The values behind these keys are bare nouns - `Bible`, not `Bible Pane` - so
 * that the word for *pane* stays in the surrounding message where a language
 * that inflects can inflect it (`панель «Библия»`, `جزء «الكتاب المقدس»`). See
 * the **Pane names** table in `locales/GLOSSARY.md`, including the trap that the
 * Book pane means a *study book*, not a book of the Bible.
 */

import type { PanelContentType } from '../stores/useLayoutStore';

/** Every panel content type except the open-ended extension namespace. */
export type NamedPaneType = Exclude<PanelContentType, `ext:${string}`>;

export const PANE_NAME_KEYS: Record<NamedPaneType, string> = {
  bible: 'paneName.bible',
  commentary: 'paneName.commentary',
  book: 'paneName.book',
  dictionary: 'paneName.dictionary',
  notes: 'paneName.notes',
  prayer: 'paneName.prayer',
  search: 'paneName.search',
  study: 'paneName.study',
  topics: 'paneName.topics',
  newtab: 'paneName.newTab',
};

/**
 * The English titles a *generic* panel of each type can have been created with.
 *
 * A panel titled after its own content - a passage (`John 3`), a module
 * (`Matthew Henry`) - is data and must never be swapped for a catalog string.
 * Only a panel still carrying the untranslated generic label is a candidate,
 * which is what this table identifies. `addPanel` falls back to the raw
 * content-type string when no display name is supplied, so that is listed too.
 *
 * Matching on the stored title rather than reading a `titleKey` param is
 * deliberate: layouts serialized by earlier versions are already on disk with
 * these exact titles, and they have to localize too.
 */
const GENERIC_ENGLISH_TITLES: Record<NamedPaneType, readonly string[]> = {
  bible: ['Bible', 'bible'],
  commentary: ['Commentary', 'commentary'],
  book: ['Book', 'Books', 'book'],
  dictionary: ['Dictionary', 'dictionary'],
  notes: ['Notes', 'Note', 'notes'],
  prayer: ['Prayer', 'prayer'],
  search: ['Search', 'search'],
  study: ['Study', 'study'],
  topics: ['Topics', 'Topic', 'topics'],
  newtab: ['New Tab', 'newtab'],
};

/**
 * The canonical generic English title to create a panel of this type with.
 *
 * Use this instead of deriving a title from whatever the user typed. Panel
 * titles are persisted, and `localizePaneLabel` only translates titles it
 * recognizes - so a title built by title-casing user input ("commentary" ->
 * "Commentary" via English casing rules) is both a locale bug and, once the
 * input differs by a character, permanently untranslatable in the saved layout.
 */
export function genericEnglishTitle(contentType: PanelContentType): string | undefined {
  if (!(contentType in PANE_NAME_KEYS)) return undefined;
  return GENERIC_ENGLISH_TITLES[contentType as NamedPaneType][0];
}

/**
 * Localize a dockview panel's stored title (or subtitle), leaving
 * content-derived titles untouched.
 *
 * Returns `stored` unchanged when the panel has no content type, when the type
 * has no catalog name, or when the title is anything other than the generic
 * English label for that type.
 */
export function localizePaneLabel(
  t: (key: string, params?: Record<string, unknown>) => string,
  contentType: PanelContentType | undefined,
  stored: string | undefined,
): string | undefined {
  if (!contentType || !stored) return stored;
  if (!(contentType in PANE_NAME_KEYS)) return stored; // ext:* panels name themselves
  const named = contentType as NamedPaneType;
  if (!GENERIC_ENGLISH_TITLES[named].includes(stored)) return stored;
  return t(PANE_NAME_KEYS[named]);
}
