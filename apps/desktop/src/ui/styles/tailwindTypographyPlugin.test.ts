import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

/**
 * Build-time guard for the `prose` classes used throughout the commentary,
 * book, and dictionary panes (CommentaryEntryView, CommentaryHome,
 * StudyRichText, DictionarySinglePanel, ...).
 *
 * Those `prose`/`prose-lg` classes only generate CSS when
 * `@tailwindcss/typography` is registered in tailwind.config.cjs's `plugins`
 * array. Without it, Tailwind emits zero rules for them while Preflight has
 * already stripped heading sizes and list bullets/padding to nothing - so
 * commentary text silently degrades to unstyled flat paragraphs (only
 * `<strong>` survives). A jsdom component test can prove the DOM structure is
 * right (see CommentaryEntryView.test.tsx) but jsdom does not apply this
 * project's real CSS cascade, so it cannot catch this class of regression.
 * This test parses the actual config module instead.
 */
const require = createRequire(import.meta.url);
const tailwindConfigPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'tailwind.config.cjs'
);

describe('tailwind.config.cjs — typography plugin registration', () => {
  it('registers @tailwindcss/typography so prose/prose-lg classes generate CSS', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require(tailwindConfigPath);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const typographyPlugin = require('@tailwindcss/typography');

    expect(Array.isArray(config.plugins)).toBe(true);
    expect(config.plugins).toContain(typographyPlugin);
  });
});
