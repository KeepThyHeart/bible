/**
 * Standard Format - the reference on its own line, the passage beneath it.
 *
 * The shape is driven by the shared `AdvancedCopyOptions` (see
 * `copyOptions.ts`): verse numbers, reference placement, chapter headings
 * and Markdown are common to Standard and Combined, while "new line per verse"
 * and the block-quote/inline choice belong to this format alone.
 *
 * Example (Markdown, reference first, verse numbers on, one verse per line,
 * block quote):
 *
 *   John 3:16-17 (KJV)
 *
 *   > (16) For God so loved the world...
 *   > (17) For God sent not his Son...
 *
 * **Retired but still registered** - see `formatRegistry.ts`. Nothing offers
 * it; a note saved with `data-expansion-format="standard"` still renders
 * through it.
 *
 * The stored shape options arrive as `settings` rather than being read here:
 * core has no storage. A dialog showing a live preview passes its unsaved
 * edits straight to {@link renderPassageCopy} instead.
 */

import type { CopyFormat, PassageVerse, VerseContext, FormatOptions } from './types';
import { truncateForPreview } from './formatHelpers';
import { resolveCopyFormatSettings, type CopyFormatSettings } from './settings';
import { renderPassageCopy } from './passageCopyRenderer';

const standardFormat: CopyFormat = {
  id: 'standard',
  name: 'Standard',
  description: 'Reference on its own line, then the passage beneath it',

  format(
    verses: PassageVerse | PassageVerse[],
    context: VerseContext,
    options: FormatOptions,
    settings?: CopyFormatSettings
  ): string {
    return renderPassageCopy(
      verses,
      context,
      options,
      resolveCopyFormatSettings(settings).advanced,
      'standard'
    );
  },

  preview(
    verses: PassageVerse | PassageVerse[],
    context: VerseContext,
    options: FormatOptions,
    settings?: CopyFormatSettings
  ): string {
    return truncateForPreview(
      renderPassageCopy(
        verses,
        context,
        options,
        resolveCopyFormatSettings(settings).advanced,
        'standard'
      ),
      150
    );
  }
};

export default standardFormat;
