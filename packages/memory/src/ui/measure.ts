/**
 * Measuring how wide a word is going to be.
 *
 * This exists for one requirement in the blanks exercise: an input standing in
 * for a hidden word must be the width of that word, so that revealing the word
 * does not repaginate the passage under the user's eyes. A blank that is
 * visibly too small or too large also leaks the answer's length in a way the
 * exercise does not intend.
 *
 * The obvious implementation - `size={word.length}` or `width: Nch` - is wrong
 * in the way that matters. `ch` is the advance width of "0", so in the
 * proportional face this panel actually renders in, "William" and "illiwam"
 * get the same box despite differing by a third of their width, and every
 * blank in the passage is off by a different amount. The only honest answer is
 * to lay the real string out in the real font and read the result back, which
 * is what {@link WordMeasurer} does with an off-screen span.
 *
 * `estimateTextWidth` is the fallback for when that cannot work - see its own
 * comment - and is pure so it can be tested without a DOM.
 */

/**
 * Rough per-character advance widths as a fraction of the font size.
 *
 * Calibrated by eye against the system UI stack this panel uses. These are not
 * meant to be accurate; they are meant to be *proportional*, so that a
 * fallback blank for "illicit" is narrower than one for "warmth" instead of
 * both being seven times some constant. Anything not listed falls through to
 * {@link DEFAULT_ADVANCE}.
 */
const NARROW = new Set('ijltfIr.,;:!\'`|[]()'.split(''));
const WIDE = new Set('mwMW@%'.split(''));
const UPPER_OR_DIGIT = /[A-Z0-9]/;

const NARROW_ADVANCE = 0.3;
const WIDE_ADVANCE = 0.92;
const UPPER_ADVANCE = 0.66;
const DEFAULT_ADVANCE = 0.52;
const SPACE_ADVANCE = 0.26;

/**
 * A DOM-free estimate of how wide `text` renders at `fontSizePx`.
 *
 * Only used when real measurement is impossible or returns nonsense - most
 * plausibly when the panel is laid out while hidden (a docked pane the user
 * has collapsed reports zero-width boxes for everything) or before a webfont
 * has settled. A blank of the wrong width is a cosmetic problem; a blank of
 * width zero is an unusable one, so there has to be a floor under this.
 */
export function estimateTextWidth(text: string, fontSizePx: number): number {
  let advance = 0;
  for (const ch of text) {
    if (ch === ' ') advance += SPACE_ADVANCE;
    else if (NARROW.has(ch)) advance += NARROW_ADVANCE;
    else if (WIDE.has(ch)) advance += WIDE_ADVANCE;
    else if (UPPER_OR_DIGIT.test(ch)) advance += UPPER_ADVANCE;
    else advance += DEFAULT_ADVANCE;
  }
  return advance * fontSizePx;
}

/**
 * The smallest a blank is ever drawn, in pixels.
 *
 * A one-letter word ("a", "O") measures to about six pixels, which is not a
 * clickable target and does not look like somewhere you can type. The floor
 * costs a little accuracy on the shortest words and buys a blank the user can
 * actually hit.
 */
export const MIN_BLANK_WIDTH_PX = 28;

/** Extra room inside the input so a caret at the end is not clipped. */
export const BLANK_PADDING_PX = 10;

/**
 * Turns a measured text width into the width the input is given.
 *
 * Pure, and separate from the measurement itself, so the padding and floor
 * policy can be asserted in a test without a browser.
 */
export function blankWidthFor(measuredPx: number): number {
  return Math.max(MIN_BLANK_WIDTH_PX, Math.ceil(measuredPx) + BLANK_PADDING_PX);
}

/**
 * Lays strings out in a real font and reports their width.
 *
 * The span is appended to the document rather than kept detached because a
 * detached element has no computed style and measures as zero. It is hidden
 * with absolute positioning off-screen instead of `display: none` for the same
 * reason - a `display: none` element is not laid out at all, so it also
 * measures as zero.
 *
 * Results are cached per (text, font) pair. A blanks step re-measures on every
 * keystroke as the user overtypes, and a passage of any length would otherwise
 * force a synchronous layout flush per character.
 */
export class WordMeasurer {
  private readonly span: HTMLSpanElement;
  private readonly cache = new Map<string, number>();
  private fontKey = '';
  private fontSizePx = 16;
  private estimated = false;

  constructor(private readonly doc: Document) {
    this.span = doc.createElement('span');
    this.span.setAttribute('aria-hidden', 'true');
    // Inline styles are permitted by the panel's CSP (only *scripts* are
    // restricted), and these belong with the element rather than in the
    // stylesheet: they are mechanism, not appearance, and a stylesheet edit
    // that "tidied them up" would silently break every blank's width.
    this.span.style.position = 'absolute';
    this.span.style.top = '-9999px';
    this.span.style.left = '-9999px';
    this.span.style.visibility = 'hidden';
    this.span.style.whiteSpace = 'pre';
    this.span.style.pointerEvents = 'none';
    doc.body.appendChild(this.span);
  }

  /**
   * Adopts the typography of `source` so subsequent measurements are taken in
   * the font the words will actually be drawn in.
   *
   * Called with the passage element, not with `document.body`: the scripture
   * text runs at a different size and family from the panel chrome, and
   * measuring a serif verse in the sans-serif UI face is the same mistake as
   * counting characters, only harder to notice.
   */
  adoptFontFrom(source: Element): void {
    const cs = this.doc.defaultView?.getComputedStyle(source);
    if (!cs) return;

    const key = [
      cs.fontStyle,
      cs.fontVariant,
      cs.fontWeight,
      cs.fontStretch,
      cs.fontSize,
      cs.lineHeight,
      cs.fontFamily,
      cs.letterSpacing,
      cs.textTransform,
    ].join('|');
    if (key === this.fontKey) return;

    this.fontKey = key;
    // Measurements taken in the previous font are meaningless now.
    this.cache.clear();

    this.span.style.fontStyle = cs.fontStyle;
    this.span.style.fontVariant = cs.fontVariant;
    this.span.style.fontWeight = cs.fontWeight;
    this.span.style.fontStretch = cs.fontStretch;
    this.span.style.fontSize = cs.fontSize;
    this.span.style.fontFamily = cs.fontFamily;
    this.span.style.letterSpacing = cs.letterSpacing;
    this.span.style.textTransform = cs.textTransform;

    const parsed = Number.parseFloat(cs.fontSize);
    if (Number.isFinite(parsed) && parsed > 0) this.fontSizePx = parsed;
  }

  /** The width `text` occupies in the adopted font, in CSS pixels. */
  measure(text: string): number {
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;

    this.span.textContent = text;
    const rect = this.span.getBoundingClientRect();
    // Zero is not a plausible width for a non-empty string; it means the panel
    // is not being laid out (collapsed pane, hidden tab). Fall back rather
    // than cache a zero that would persist after the pane is reopened.
    const width =
      rect.width > 0 ? rect.width : estimateTextWidth(text, this.fontSizePx);

    if (rect.width > 0) this.cache.set(text, width);
    else this.estimated = true;
    return width;
  }

  /**
   * True if any `measure` call since the last {@link invalidate} had to fall
   * back to {@link estimateTextWidth}. Widths handed out in that state are
   * proportional but not exact, so a caller holding them should re-measure
   * once real layout exists.
   */
  get usedEstimate(): boolean {
    return this.estimated;
  }

  /**
   * Forgets every cached measurement and the estimate flag.
   *
   * `adoptFontFrom` only clears on a font-key change, which cannot see a
   * webfont finishing loading under an unchanged `font-family` string, so a
   * re-measure pass (pane becoming visible, fonts settling) calls this rather
   * than trusting whatever was cached earlier.
   */
  invalidate(): void {
    this.cache.clear();
    this.estimated = false;
  }

  /** The width an input standing in for `text` should be given. */
  blankWidth(text: string): number {
    return blankWidthFor(this.measure(text));
  }

  dispose(): void {
    this.span.remove();
    this.cache.clear();
  }
}
