/**
 * Registers every built-in `Localizer` this repo ships a book-name table for,
 * beyond the `en` one already baked into `Localizer.ts`'s registry.
 *
 * This is the "one place to plug in a language" the `Localizer` module doc
 * promises: importing this module (which both `../../index.ts` and
 * `../../browser.ts` do, so anything that imports `@bible/core` or
 * `@bible/core/browser` gets it for free) is enough to make `getLocalizer(tag)`
 * start returning a fuller `Localizer` for that tag - no call site anywhere
 * else has to change. Adding the next language's table is exactly one more
 * `registerLocalizer(...)` line here, once `Data/Locales/books/<tag>.ts`
 * exists for it.
 */

import { createIntlLocalizer, registerLocalizer } from './Localizer';
import { ES_BOOK_NAMES, ES_DISPLAY_NAMES, ES_SINGLE_CHAPTER_BOOKS } from './books/es';
import { ZH_HANS_BOOK_NAMES, ZH_HANS_DISPLAY_NAMES, ZH_HANS_SINGLE_CHAPTER_BOOKS } from './books/zhHans';

export const SpanishLocalizer = createIntlLocalizer('es', {
  referenceParserConfig: {
    bookNames: ES_BOOK_NAMES,
    displayNames: ES_DISPLAY_NAMES,
    singleChapterBooks: ES_SINGLE_CHAPTER_BOOKS,
  },
});

export const ChineseSimplifiedLocalizer = createIntlLocalizer('zh-Hans', {
  referenceParserConfig: {
    bookNames: ZH_HANS_BOOK_NAMES,
    displayNames: ZH_HANS_DISPLAY_NAMES,
    singleChapterBooks: ZH_HANS_SINGLE_CHAPTER_BOOKS,
  },
});

registerLocalizer(SpanishLocalizer);
registerLocalizer(ChineseSimplifiedLocalizer);
