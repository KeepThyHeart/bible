/**
 * The passage formatters emit red-letter text with a hard-coded `#B71C1C`, which is right for the clipboard (white
 * documents) but unreadable on the dark and High Contrast themes the dialog preview is shown on (B-189). The preview
 * swaps it for the theme's red-letter token, which each theme holds to WCAG AA against its page colour.
 */
export function themeRedLetterPreview(html: string): string {
  return html.replace(/color:\s*#B71C1C\s*;?/gi, 'color: var(--theme-christ, #B71C1C);');
}
