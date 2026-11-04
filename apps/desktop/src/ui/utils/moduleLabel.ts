/**
 * Module names come from the data. Nave's spells its apostrophe with U+07F4
 * (N'Ko high tone apostrophe), a strong right-to-left character: in an
 * Arabic or Hebrew UI it reorders the label to "s Topical Bible'Nave". Map the
 * N'Ko apostrophes to the ordinary typographic one, which is bidi-neutral.
 */
export function normalizeModuleLabel(label: string): string {
  return label.replace(/[ߴߵ]/g, '’');
}
