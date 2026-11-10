/**
 * Size a literal for text inside the Study pane from the "Study / pane text"
 * setting (B-074).
 *
 * `.pane-content-study` (globals.css) publishes the setting's resolved size as
 * `--study-fs` - `--study-font-size` x the global font scale, the same product
 * every other pane's text class uses. Each literal is expressed as a fraction
 * of the 16px default, so the pane's hierarchy (a 10px label stays visibly
 * smaller than a 16px title) holds at any setting, and at the default every
 * size is exactly the literal it replaces.
 *
 * Outside a Study pane `--study-fs` is unset and the fallback is the rem root,
 * so a component shared with another pane (the topic list, the suggestion
 * banner, the digest notice) renders exactly as it always did there.
 */
export function studyScaled(px: number): string {
  return `calc(${px / 16} * var(--study-fs, 1rem))`;
}
