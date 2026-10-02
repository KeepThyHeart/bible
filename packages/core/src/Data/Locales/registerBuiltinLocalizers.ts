/**
 * Built-in `Localizer`s with reference data. Since task 0077 a locale's book
 * names come from the reference engine's JSON data (`Reference/locales/`),
 * loaded on demand with `loadReferenceLocales()`, and every `Localizer`
 * built by `createIntlLocalizer` picks them up through its
 * `referenceParserConfig` getter - so nothing needs registering per
 * language any more. These two names stay exported for existing imports.
 */

import { createIntlLocalizer, registerLocalizer } from './Localizer';

export const SpanishLocalizer = createIntlLocalizer('es');

export const ChineseSimplifiedLocalizer = createIntlLocalizer('zh-Hans');

registerLocalizer(SpanishLocalizer);
registerLocalizer(ChineseSimplifiedLocalizer);
