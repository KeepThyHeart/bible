/**
 * The desktop app's half of the advanced copy options: the storage.
 *
 * What the options *mean* - and how each field falls back - is core's, and is
 * tested there (`@bible/core`'s `PassageFormat/passageCopyRenderer.test.ts`).
 * What is pinned here is that this app writes and reads them under its own
 * key, and that a store which cannot be read costs the user their settings
 * rather than their ability to copy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ADVANCED_COPY_OPTIONS_KEY,
  DEFAULT_ADVANCED_COPY_OPTIONS,
  loadAdvancedCopyOptions,
  saveAdvancedCopyOptions,
  type AdvancedCopyOptions,
} from './advancedOptions';
import { loadCopyFormatSettings } from './index';
import { BUILTIN_TEMPLATES } from '@bible/core';

describe('advanced option persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips every field', () => {
    const options: AdvancedCopyOptions = {
      newLinePerVerse: false,
      textFormat: 'inline',
      paragraphBreaks: true,
      includeVerseNumbers: false,
      includeChapterHeadings: false,
      referencePosition: 'end',
      markdown: true,
    };
    saveAdvancedCopyOptions(options);
    expect(loadAdvancedCopyOptions()).toEqual(options);
  });

  it('falls back to the defaults when nothing is stored', () => {
    expect(loadAdvancedCopyOptions()).toEqual(DEFAULT_ADVANCED_COPY_OPTIONS);
  });

  it('falls back to the defaults on a malformed blob', () => {
    localStorage.setItem(ADVANCED_COPY_OPTIONS_KEY, 'not json');
    expect(loadAdvancedCopyOptions()).toEqual(DEFAULT_ADVANCED_COPY_OPTIONS);
  });

  it('falls back per field, so one bad value cannot discard the rest', () => {
    localStorage.setItem(
      ADVANCED_COPY_OPTIONS_KEY,
      JSON.stringify({
        newLinePerVerse: false,
        textFormat: 'sideways',
        referencePosition: 'sideways',
      }),
    );

    expect(loadAdvancedCopyOptions()).toEqual({
      ...DEFAULT_ADVANCED_COPY_OPTIONS,
      newLinePerVerse: false,
    });
  });
});

describe('the settings handed to a copy format', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Core's formats take their stored state as an argument. This is the one
  // place that argument is assembled, so it has to read both halves - the
  // shape options and the active template - from this app's own storage.
  it('carries the saved advanced options and the active template text', () => {
    saveAdvancedCopyOptions({ ...DEFAULT_ADVANCED_COPY_OPTIONS, markdown: true });

    const settings = loadCopyFormatSettings();
    expect(settings.advanced.markdown).toBe(true);
    expect(settings.templateText).toBe(BUILTIN_TEMPLATES[0].template);
  });
});
