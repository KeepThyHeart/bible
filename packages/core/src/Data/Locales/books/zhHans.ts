/**
 * Chinese, Simplified (`zh-Hans`) book-name table for
 * `Localizer.referenceParserConfig`.
 *
 * Names follow the 和合本 (Chinese Union Version), 神版, consistent with the
 * edition decision this repo already recorded for `zh-Hans` (see
 * `apps/desktop/locales/GLOSSARY.md` and the Scripture-sample table in
 * `apps/desktop/locales/README.md`). These are the standard book titles used
 * throughout Chinese Protestant Bible publishing - reference data, not a
 * translation judgment call.
 *
 * ## `ZH_HANS_BOOK_NAMES` does not make Chinese-script reference parsing work
 *
 * This is worth stating plainly rather than leaving implicit. `ReferenceParser`
 * (`../../Services/ReferenceParser.ts`) extracts a candidate book name with the
 * regex `[a-z]+` (case-insensitive, **ASCII only**) *before* it ever consults
 * a book-name table - so a reference typed in Chinese script, e.g.
 * "约翰福音 3:16", never matches that regex at all, and {@link ZH_HANS_BOOK_NAMES}
 * is therefore never reached for parsing through the shared `ReferenceParser`
 * class, no matter what it contains. This is exactly the case the interface's
 * own doc comment anticipates: "languages with fundamentally different
 * reference syntax (e.g. CJK) can implement `IReferenceParser` directly" - a
 * Unicode-aware CJK parser (matching `\p{Script=Han}` text, and deciding how
 * to handle full-width vs. Latin digits for chapter/verse numbers) is a
 * separate, not-yet-built piece of work, out of scope here.
 *
 * `ZH_HANS_BOOK_NAMES` is still included below (a) for completeness and
 * correctness of `getBookNumber()` as a direct lookup for any future caller
 * that already has an exact Chinese book name in hand (bypassing the ASCII
 * regex entirely), and (b) so the day a CJK-aware `IReferenceParser` is built,
 * the alias data is already sitting here ready to reuse rather than needing to
 * be drafted from scratch.
 *
 * {@link ZH_HANS_DISPLAY_NAMES}, in contrast, is immediately useful today: book
 * **display** (as opposed to parsing) does not go through that regex at all,
 * so wiring a `zh-Hans` `Localizer` with this table makes book names actually
 * appear in Chinese throughout the UI wherever a consumer reads
 * `Localizer.referenceParserConfig?.displayNames`.
 */

import { ENGLISH_SINGLE_CHAPTER_BOOKS } from '../../Core/BookNames';

/** Long (full) Chinese book names, in book-number order (index 0 = book 1, 创世记). */
export const ZH_HANS_DISPLAY_NAMES: string[] = [
  '创世记', '出埃及记', '利未记', '民数记', '申命记', '约书亚记', '士师记', '路得记',
  '撒母耳记上', '撒母耳记下', '列王纪上', '列王纪下', '历代志上', '历代志下', '以斯拉记',
  '尼希米记', '以斯帖记', '约伯记', '诗篇', '箴言', '传道书', '雅歌',
  '以赛亚书', '耶利米书', '耶利米哀歌', '以西结书', '但以理书', '何西阿书', '约珥书', '阿摩司书',
  '俄巴底亚书', '约拿书', '弥迦书', '那鸿书', '哈巴谷书', '西番雅书', '哈该书', '撒迦利亚书',
  '玛拉基书', '马太福音', '马可福音', '路加福音', '约翰福音', '使徒行传', '罗马书', '哥林多前书',
  '哥林多后书', '加拉太书', '以弗所书', '腓立比书', '歌罗西书', '帖撒罗尼迦前书',
  '帖撒罗尼迦后书', '提摩太前书', '提摩太后书', '提多书', '腓利门书', '希伯来书', '雅各书',
  '彼得前书', '彼得后书', '约翰一书', '约翰二书', '约翰三书', '犹大书', '启示录',
];

/**
 * Common one/two-character abbreviations used in Chinese study-Bible
 * cross-reference systems (串珠, per the glossary), in book-number order. Not
 * part of {@link ReferenceParserConfig} (which has no short/medium slot
 * today) - exported for a consumer (e.g. a web `booksShort` catalog
 * namespace) that wants one consistent source rather than inventing its own.
 */
export const ZH_HANS_SHORT_NAMES: string[] = [
  '创', '出', '利', '民', '申', '书', '士', '得',
  '撒上', '撒下', '王上', '王下', '代上', '代下', '拉',
  '尼', '斯', '伯', '诗', '箴', '传', '歌',
  '赛', '耶', '哀', '结', '但', '何', '珥', '摩',
  '俄', '拿', '弥', '鸿', '哈', '番', '该', '亚',
  '玛', '太', '可', '路', '约', '徒', '罗', '林前',
  '林后', '加', '弗', '腓', '西', '帖前',
  '帖后', '提前', '提后', '多', '门', '来', '雅',
  '彼前', '彼后', '约一', '约二', '约三', '犹', '启',
];

/**
 * Book name/abbreviation -> book number (1-66). See the module doc: this is
 * data completeness for a future CJK-aware parser, not a working alias table
 * for today's `ReferenceParser` (its regex cannot match Chinese script at
 * all). Includes both the long name and the short abbreviation from
 * {@link ZH_HANS_SHORT_NAMES} as keys, since both are in everyday use.
 */
export const ZH_HANS_BOOK_NAMES: Map<string, number> = new Map([
  ['创世记', 1], ['创', 1],
  ['出埃及记', 2], ['出', 2],
  ['利未记', 3], ['利', 3],
  ['民数记', 4], ['民', 4],
  ['申命记', 5], ['申', 5],
  ['约书亚记', 6], ['书', 6],
  ['士师记', 7], ['士', 7],
  ['路得记', 8], ['得', 8],
  ['撒母耳记上', 9], ['撒上', 9],
  ['撒母耳记下', 10], ['撒下', 10],
  ['列王纪上', 11], ['王上', 11],
  ['列王纪下', 12], ['王下', 12],
  ['历代志上', 13], ['代上', 13],
  ['历代志下', 14], ['代下', 14],
  ['以斯拉记', 15], ['拉', 15],
  ['尼希米记', 16], ['尼', 16],
  ['以斯帖记', 17], ['斯', 17],
  ['约伯记', 18], ['伯', 18],
  ['诗篇', 19], ['诗', 19],
  ['箴言', 20], ['箴', 20],
  ['传道书', 21], ['传', 21],
  ['雅歌', 22], ['歌', 22],
  ['以赛亚书', 23], ['赛', 23],
  ['耶利米书', 24], ['耶', 24],
  ['耶利米哀歌', 25], ['哀', 25],
  ['以西结书', 26], ['结', 26],
  ['但以理书', 27], ['但', 27],
  ['何西阿书', 28], ['何', 28],
  ['约珥书', 29], ['珥', 29],
  ['阿摩司书', 30], ['摩', 30],
  ['俄巴底亚书', 31], ['俄', 31],
  ['约拿书', 32], ['拿', 32],
  ['弥迦书', 33], ['弥', 33],
  ['那鸿书', 34], ['鸿', 34],
  ['哈巴谷书', 35], ['哈', 35],
  ['西番雅书', 36], ['番', 36],
  ['哈该书', 37], ['该', 37],
  ['撒迦利亚书', 38], ['亚', 38],
  ['玛拉基书', 39], ['玛', 39],
  ['马太福音', 40], ['太', 40],
  ['马可福音', 41], ['可', 41],
  ['路加福音', 42], ['路', 42],
  ['约翰福音', 43], ['约', 43],
  ['使徒行传', 44], ['徒', 44],
  ['罗马书', 45], ['罗', 45],
  ['哥林多前书', 46], ['林前', 46],
  ['哥林多后书', 47], ['林后', 47],
  ['加拉太书', 48], ['加', 48],
  ['以弗所书', 49], ['弗', 49],
  ['腓立比书', 50], ['腓', 50],
  ['歌罗西书', 51], ['西', 51],
  ['帖撒罗尼迦前书', 52], ['帖前', 52],
  ['帖撒罗尼迦后书', 53], ['帖后', 53],
  ['提摩太前书', 54], ['提前', 54],
  ['提摩太后书', 55], ['提后', 55],
  ['提多书', 56], ['多', 56],
  ['腓利门书', 57], ['门', 57],
  ['希伯来书', 58], ['来', 58],
  ['雅各书', 59], ['雅', 59],
  ['彼得前书', 60], ['彼前', 60],
  ['彼得后书', 61], ['彼后', 61],
  ['约翰一书', 62], ['约一', 62],
  ['约翰二书', 63], ['约二', 63],
  ['约翰三书', 64], ['约三', 64],
  ['犹大书', 65], ['犹', 65],
  ['启示录', 66], ['启', 66],
]);

/** Same five single-chapter books as every locale (Obadiah, Philemon, 2 John, 3 John, Jude) - keyed by book number, not name. */
export const ZH_HANS_SINGLE_CHAPTER_BOOKS = ENGLISH_SINGLE_CHAPTER_BOOKS;
