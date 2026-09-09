/**
 * The stored state a copy format needs handed to it.
 *
 * Standard and Combined render through the user's saved `AdvancedCopyOptions`;
 * Custom Template renders whatever template text the user last edited. Core
 * takes both as arguments rather than reading them itself: `localStorage` is a
 * renderer API, and the app that owns the storage key is what should read it.
 */

import { BUILTIN_TEMPLATES } from '../CopyService';
import { AdvancedCopyOptions, DEFAULT_ADVANCED_COPY_OPTIONS } from './copyOptions';

export interface CopyFormatSettings {
  /** The shape controls behind Standard and Combined. */
  advanced: AdvancedCopyOptions;
  /** The active Handlebars-style template text behind Custom Template. */
  templateText: string;
}

/**
 * What a format renders through when the caller supplies nothing: the option
 * defaults and the first built-in template - which is exactly what a user who
 * has never opened the dialog has stored.
 */
export const DEFAULT_COPY_FORMAT_SETTINGS: CopyFormatSettings = {
  advanced: DEFAULT_ADVANCED_COPY_OPTIONS,
  templateText: BUILTIN_TEMPLATES[0].template,
};

/** Fill in whichever half the caller left out. */
export function resolveCopyFormatSettings(
  settings: CopyFormatSettings | undefined,
): CopyFormatSettings {
  return settings ?? DEFAULT_COPY_FORMAT_SETTINGS;
}
