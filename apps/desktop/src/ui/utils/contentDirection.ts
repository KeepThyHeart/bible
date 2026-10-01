/**
 * Content-direction attributes for a module's text (task 0076).
 *
 * Scripture, commentary, dictionary and book text follow the MODULE's
 * language, never the UI's: an Arabic UI showing the KJV is LTR text inside RTL
 * chrome. Spread the result onto the element that contains the module text:
 *
 *   <div {...contentDirAttrs(module.language_code)}>...</div>
 *
 * `globals.css` gives `[data-content-dir]` `unicode-bidi: isolate`, so a
 * differing content direction cannot reorder the chrome around it.
 */

import { directionForLanguage } from '@bible/core/browser';
import type { LocaleDirection } from '@bible/core/browser';

export interface ContentDirAttrs {
  dir: LocaleDirection;
  lang?: string;
  'data-content-dir': LocaleDirection;
}

/** `dir`, `lang` and `data-content-dir` for text in the given module language. */
export function contentDirAttrs(language: string | null | undefined): ContentDirAttrs {
  const dir = directionForLanguage(language);
  return { dir, lang: language || undefined, 'data-content-dir': dir };
}
