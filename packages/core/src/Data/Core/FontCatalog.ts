/**
 * The curated catalogue of reading fonts both apps offer.
 *
 * One list instead of the two the desktop used to keep (Typography's `AVAILABLE_FONT_FAMILIES` and the
 * per-pane `AVAILABLE_FONTS`) plus the web's own: ids are what is stored in settings, so they never change;
 * a label or stack may.
 *
 * Nothing proprietary is bundled. `bundled` entries ship with the app (see `scripts/fetch-fonts.mjs`) and are
 * always available; every other entry is a face the operating system may already have, and is offered only
 * where {@link isFontInstalled} (`@bible/ui`) finds it. A saved choice that is not installed on this machine is
 * kept, and renders through the rest of its CSS stack.
 */

export type FontKind = 'serif' | 'sans';

/** Where the face comes from. `any` = common on several systems (Georgia, Palatino, Times). */
export type FontOrigin = 'bundled' | 'windows' | 'mac' | 'linux' | 'any';

export interface FontCatalogEntry {
  /** Stored in settings; permanent. */
  id: string;
  /** Shown in the picker (a typeface name, so it is not translated). */
  label: string;
  /** The family name looked for on the machine (`bundled` entries are not looked for). */
  family: string;
  /** Full CSS `font-family` value, ending in a generic family so a missing face degrades cleanly. */
  stack: string;
  kind: FontKind;
  origin: FontOrigin;
}

const SERIF = 'serif';
const SANS = 'sans-serif';

function entry(
  id: string,
  label: string,
  kind: FontKind,
  origin: FontOrigin,
  fallbacks: string,
  family: string = label,
): FontCatalogEntry {
  const generic = kind === 'serif' ? SERIF : SANS;
  return { id, label, family, kind, origin, stack: `"${family}"${fallbacks ? `, ${fallbacks}` : ''}, ${generic}` };
}

export const FONT_CATALOG: readonly FontCatalogEntry[] = [
  // Ids that predate the catalogue keep their historical stacks' spirit.
  entry('georgia', 'Georgia', 'serif', 'any', '"Times New Roman"'),
  entry('times', 'Times New Roman', 'serif', 'any', 'Times'),
  entry('palatino', 'Palatino', 'serif', 'any', '"Palatino Linotype", "Book Antiqua", Georgia'),
  entry('garamond', 'Garamond', 'serif', 'any', '"EB Garamond", "Times New Roman"'),
  entry('lora', 'Lora', 'serif', 'any', 'Georgia, "Times New Roman"'),
  entry('eb-garamond', 'EB Garamond', 'serif', 'any', 'Garamond, "Times New Roman"'),

  // Bundled with the app: always available.
  entry('merriweather', 'Merriweather', 'serif', 'bundled', 'Georgia, "Times New Roman"'),
  entry('crimson-text', 'Crimson Text', 'serif', 'bundled', 'Georgia'),
  entry('libre-baskerville', 'Libre Baskerville', 'serif', 'bundled', 'Georgia'),
  entry('noto-serif', 'Noto Serif', 'serif', 'bundled', 'Georgia'),

  // Windows.
  entry('candara', 'Candara', 'sans', 'windows', 'Calibri, "Segoe UI"'),
  entry('calibri', 'Calibri', 'sans', 'windows', '"Segoe UI"'),
  entry('segoe-ui', 'Segoe UI', 'sans', 'windows', 'Tahoma'),
  entry('corbel', 'Corbel', 'sans', 'windows', 'Calibri, "Segoe UI"'),
  entry('constantia', 'Constantia', 'serif', 'windows', 'Georgia'),
  entry('cambria', 'Cambria', 'serif', 'windows', 'Georgia'),
  entry('verdana', 'Verdana', 'sans', 'windows', 'Tahoma'),
  entry('palatino-linotype', 'Palatino Linotype', 'serif', 'windows', '"Book Antiqua", Georgia'),
  entry('book-antiqua', 'Book Antiqua', 'serif', 'windows', '"Palatino Linotype", Georgia'),

  // macOS.
  entry('avenir-next', 'Avenir Next', 'sans', 'mac', 'Avenir, "Helvetica Neue"'),
  entry('seravek', 'Seravek', 'sans', 'mac', '"Helvetica Neue"'),
  entry('charter', 'Charter', 'serif', 'mac', '"Bitstream Charter", Georgia'),
  entry('iowan-old-style', 'Iowan Old Style', 'serif', 'mac', 'Georgia'),
  entry('hoefler-text', 'Hoefler Text', 'serif', 'mac', 'Georgia'),

  // Linux.
  entry('noto-sans', 'Noto Sans', 'sans', 'linux', '"Open Sans"'),
  entry('dejavu-sans', 'DejaVu Sans', 'sans', 'linux', 'Verdana'),
  entry('dejavu-serif', 'DejaVu Serif', 'serif', 'linux', 'Georgia'),
  entry('liberation-sans', 'Liberation Sans', 'sans', 'linux', 'Arial'),
  entry('liberation-serif', 'Liberation Serif', 'serif', 'linux', '"Times New Roman"'),
  entry('ubuntu', 'Ubuntu', 'sans', 'linux', '"Segoe UI"'),
];

/** The entry for a stored id, if the catalogue knows it. */
export function fontCatalogEntry(id: string): FontCatalogEntry | undefined {
  return FONT_CATALOG.find((f) => f.id === id);
}

/**
 * The catalogue entries to show: bundled ones always, the rest when `isInstalled(family)` says so.
 * `keepId` (the currently saved choice) is always included so a face this machine lacks stays visible and
 * selected instead of silently becoming something else.
 */
export function offeredFonts(
  isInstalled: (family: string) => boolean,
  keepId?: string,
): FontCatalogEntry[] {
  return FONT_CATALOG.filter((f) => f.origin === 'bundled' || f.id === keepId || isInstalled(f.family));
}
