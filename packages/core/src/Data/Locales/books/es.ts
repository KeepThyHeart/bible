/**
 * Spanish (`es`) book-name table for `Localizer.referenceParserConfig`.
 *
 * Names follow the Reina-Valera tradition, consistent with the edition
 * decisions this repo already recorded for `es` (see
 * `apps/desktop/locales/GLOSSARY.md` and the Scripture-sample table in
 * `apps/desktop/locales/README.md`). Unlike a translated UI string, a Bible
 * book title has essentially one broadly agreed rendering across
 * Spanish-language Bible publishing, so this is closer to reference data than
 * a judgment call - still, a native-speaker sweep of the alias list below
 * (particularly the abbreviations, which vary more by publisher) is welcome,
 * the same as with any other locale table in this repo.
 *
 * ## Why every accented alias also has an unaccented ASCII form
 *
 * `ReferenceParser`'s matching regex (`../../Services/ReferenceParser.ts`) is
 * `[a-z]+` (case-insensitive, **ASCII only**) - it does not match accented
 * letters (á é í ó ú ñ) at all, so a reference typed with its proper accent,
 * e.g. "Génesis 1:1", never reaches the alias lookup below; only the
 * unaccented "Genesis 1:1" does. Every Spanish book name that carries an
 * accent therefore has an unaccented alias alongside it, so parsing still
 * works for someone who types the name without diacritics (the common case
 * when typing quickly on a non-Spanish keyboard) - the name *displayed* back
 * to the user is still the correctly accented form from
 * {@link ES_DISPLAY_NAMES}. This is a real limitation of the shared parser
 * (see its own doc comment), not a Spanish-specific choice: any future
 * Latin-script locale with its own diacritics (French, Portuguese,
 * Vietnamese, Turkish) will need the same workaround until the parser itself
 * moves to a Unicode-aware pattern.
 */

import { ENGLISH_SINGLE_CHAPTER_BOOKS } from '../../Core/BookNames';

/** Long (full) Spanish book names, in book-number order (index 0 = book 1, Génesis). */
export const ES_DISPLAY_NAMES: string[] = [
  'Génesis', 'Éxodo', 'Levítico', 'Números', 'Deuteronomio', 'Josué', 'Jueces', 'Rut',
  '1 Samuel', '2 Samuel', '1 Reyes', '2 Reyes', '1 Crónicas', '2 Crónicas', 'Esdras',
  'Nehemías', 'Ester', 'Job', 'Salmos', 'Proverbios', 'Eclesiastés', 'Cantares',
  'Isaías', 'Jeremías', 'Lamentaciones', 'Ezequiel', 'Daniel', 'Oseas', 'Joel', 'Amós',
  'Abdías', 'Jonás', 'Miqueas', 'Nahúm', 'Habacuc', 'Sofonías', 'Hageo', 'Zacarías',
  'Malaquías', 'Mateo', 'Marcos', 'Lucas', 'Juan', 'Hechos', 'Romanos', '1 Corintios',
  '2 Corintios', 'Gálatas', 'Efesios', 'Filipenses', 'Colosenses', '1 Tesalonicenses',
  '2 Tesalonicenses', '1 Timoteo', '2 Timoteo', 'Tito', 'Filemón', 'Hebreos', 'Santiago',
  '1 Pedro', '2 Pedro', '1 Juan', '2 Juan', '3 Juan', 'Judas', 'Apocalipsis',
];

/**
 * Common Reina-Valera-tradition short abbreviations, in book-number order.
 * Not part of {@link ReferenceParserConfig} (which has no short/medium slot
 * today) - exported for a consumer (e.g. a web `booksShort` catalog
 * namespace) that wants one consistent source for Spanish abbreviations
 * rather than inventing its own.
 */
export const ES_SHORT_NAMES: string[] = [
  'Gn', 'Éx', 'Lv', 'Nm', 'Dt', 'Jos', 'Jue', 'Rt',
  '1 S', '2 S', '1 R', '2 R', '1 Cr', '2 Cr', 'Esd',
  'Neh', 'Est', 'Job', 'Sal', 'Pr', 'Ec', 'Cnt',
  'Is', 'Jer', 'Lm', 'Ez', 'Dn', 'Os', 'Jl', 'Am',
  'Abd', 'Jon', 'Mi', 'Nah', 'Hab', 'Sof', 'Hag', 'Zac',
  'Mal', 'Mt', 'Mr', 'Lc', 'Jn', 'Hch', 'Ro', '1 Co',
  '2 Co', 'Gá', 'Ef', 'Fil', 'Col', '1 Ts',
  '2 Ts', '1 Ti', '2 Ti', 'Tit', 'Flm', 'Heb', 'Stg',
  '1 P', '2 P', '1 Jn', '2 Jn', '3 Jn', 'Jud', 'Ap',
];

/** Book name/abbreviation (lowercase) -> book number (1-66). See the module doc for the accent-folding rule. */
export const ES_BOOK_NAMES: Map<string, number> = new Map([
  ['génesis', 1], ['genesis', 1], ['gn', 1], ['gen', 1],
  ['éxodo', 2], ['exodo', 2], ['ex', 2], ['éx', 2],
  ['levítico', 3], ['levitico', 3], ['lv', 3], ['lev', 3],
  ['números', 4], ['numeros', 4], ['nm', 4], ['num', 4],
  ['deuteronomio', 5], ['dt', 5], ['deut', 5],
  ['josué', 6], ['josue', 6], ['jos', 6],
  ['jueces', 7], ['jue', 7], ['jc', 7],
  ['rut', 8], ['rt', 8],
  ['1 samuel', 9], ['1samuel', 9], ['1s', 9], ['1 sam', 9], ['i samuel', 9], ['i sam', 9], ['isamuel', 9],
  ['2 samuel', 10], ['2samuel', 10], ['2s', 10], ['2 sam', 10], ['ii samuel', 10], ['ii sam', 10], ['iisamuel', 10],
  ['1 reyes', 11], ['1reyes', 11], ['1r', 11], ['1 re', 11], ['i reyes', 11], ['ireyes', 11],
  ['2 reyes', 12], ['2reyes', 12], ['2r', 12], ['2 re', 12], ['ii reyes', 12], ['iireyes', 12],
  ['1 crónicas', 13], ['1 cronicas', 13], ['1cronicas', 13], ['1cr', 13], ['i cronicas', 13], ['icronicas', 13],
  ['2 crónicas', 14], ['2 cronicas', 14], ['2cronicas', 14], ['2cr', 14], ['ii cronicas', 14], ['iicronicas', 14],
  ['esdras', 15], ['esd', 15], ['ed', 15],
  ['nehemías', 16], ['nehemias', 16], ['neh', 16], ['ne', 16],
  ['ester', 17], ['est', 17], ['es', 17],
  ['job', 18], ['jb', 18],
  ['salmos', 19], ['salmo', 19], ['sal', 19], ['sl', 19], ['salmo.', 19],
  ['proverbios', 20], ['prov', 20], ['pr', 20],
  ['eclesiastés', 21], ['eclesiastes', 21], ['ecl', 21], ['ec', 21], ['qoh', 21],
  ['cantares', 22], ['cantar de los cantares', 22], ['cantar', 22], ['cnt', 22], ['cant', 22], ['cc', 22],
  ['isaías', 23], ['isaias', 23], ['is', 23], ['isa', 23],
  ['jeremías', 24], ['jeremias', 24], ['jer', 24], ['je', 24],
  ['lamentaciones', 25], ['lam', 25], ['lm', 25],
  ['ezequiel', 26], ['ez', 26], ['eze', 26], ['ezeq', 26],
  ['daniel', 27], ['dn', 27], ['dan', 27],
  ['oseas', 28], ['os', 28], ['ose', 28],
  ['joel', 29], ['jl', 29], ['joe', 29],
  ['amós', 30], ['amos', 30], ['am', 30],
  ['abdías', 31], ['abdias', 31], ['abd', 31], ['ab', 31],
  ['jonás', 32], ['jonas', 32], ['jon', 32],
  ['miqueas', 33], ['miq', 33], ['mi', 33], ['mic', 33],
  ['nahúm', 34], ['nahum', 34], ['nah', 34], ['na', 34],
  ['habacuc', 35], ['hab', 35], ['ha', 35],
  ['sofonías', 36], ['sofonias', 36], ['sof', 36], ['so', 36],
  ['hageo', 37], ['hag', 37], ['ha.', 37],
  ['zacarías', 38], ['zacarias', 38], ['zac', 38], ['zc', 38],
  ['malaquías', 39], ['malaquias', 39], ['mal', 39], ['ml', 39],
  ['mateo', 40], ['mt', 40], ['mat', 40],
  ['marcos', 41], ['mr', 41], ['mc', 41], ['mar', 41],
  ['lucas', 42], ['lc', 42], ['luc', 42],
  ['juan', 43], ['jn', 43], ['jn.', 43],
  ['hechos', 44], ['hch', 44], ['hch.', 44], ['hec', 44],
  ['romanos', 45], ['ro', 45], ['rom', 45],
  ['1 corintios', 46], ['1corintios', 46], ['1co', 46], ['1 cor', 46], ['i corintios', 46], ['icorintios', 46],
  ['2 corintios', 47], ['2corintios', 47], ['2co', 47], ['2 cor', 47], ['ii corintios', 47], ['iicorintios', 47],
  ['gálatas', 48], ['galatas', 48], ['ga', 48], ['gal', 48],
  ['efesios', 49], ['ef', 49], ['efe', 49],
  ['filipenses', 50], ['fil', 50], ['flp', 50],
  ['colosenses', 51], ['col', 51], ['co', 51],
  ['1 tesalonicenses', 52], ['1tesalonicenses', 52], ['1ts', 52], ['1 tes', 52], ['i tesalonicenses', 52], ['itesalonicenses', 52],
  ['2 tesalonicenses', 53], ['2tesalonicenses', 53], ['2ts', 53], ['2 tes', 53], ['ii tesalonicenses', 53], ['iitesalonicenses', 53],
  ['1 timoteo', 54], ['1timoteo', 54], ['1ti', 54], ['1 tim', 54], ['i timoteo', 54], ['itimoteo', 54],
  ['2 timoteo', 55], ['2timoteo', 55], ['2ti', 55], ['2 tim', 55], ['ii timoteo', 55], ['iitimoteo', 55],
  ['tito', 56], ['tit', 56], ['ti', 56],
  ['filemón', 57], ['filemon', 57], ['flm', 57], ['fil.', 57],
  ['hebreos', 58], ['heb', 58], ['he', 58],
  ['santiago', 59], ['stg', 59], ['sant', 59], ['sg', 59],
  ['1 pedro', 60], ['1pedro', 60], ['1p', 60], ['1 pe', 60], ['i pedro', 60], ['ipedro', 60],
  ['2 pedro', 61], ['2pedro', 61], ['2p', 61], ['2 pe', 61], ['ii pedro', 61], ['iipedro', 61],
  ['1 juan', 62], ['1juan', 62], ['1jn', 62], ['1 jn', 62], ['i juan', 62], ['ijuan', 62],
  ['2 juan', 63], ['2juan', 63], ['2jn', 63], ['2 jn', 63], ['ii juan', 63], ['iijuan', 63],
  ['3 juan', 64], ['3juan', 64], ['3jn', 64], ['3 jn', 64], ['iii juan', 64], ['iiijuan', 64],
  ['judas', 65], ['jud', 65], ['jds', 65],
  ['apocalipsis', 66], ['ap', 66], ['apoc', 66], ['apo', 66],
]);

/** Same five single-chapter books as every locale (Obadiah, Philemon, 2 John, 3 John, Jude) - keyed by book number, not name. */
export const ES_SINGLE_CHAPTER_BOOKS = ENGLISH_SINGLE_CHAPTER_BOOKS;
