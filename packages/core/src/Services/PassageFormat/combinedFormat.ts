/**
 * Combined Format - the whole passage on one running line, reference inlined.
 *
 * The shape is driven by the shared `AdvancedCopyOptions` (see
 * `copyOptions.ts`): verse numbers, reference placement, chapter headings
 * and Markdown are common to Standard and Combined, while "preserve paragraphs"
 * belongs to this format alone.
 *
 * Example (reference first, verse numbers off):
 *
 *   (John 3:16-17, KJV) For God so loved the world...  For God sent not his Son...
 *
 * **Retired but still registered** - see `formatRegistry.ts`. Nothing offers
 * it; a note saved with `data-expansion-format="combined"` still renders
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

const combinedFormat: CopyFormat = {
  id: 'combined',
  name: 'Combined',
  description: 'The whole passage on one line, with the reference inline',

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
      'combined'
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
        'combined'
      ),
      150
    );
  }
};

export default combinedFormat;
