/**
 * Rendering scripture: poetry, prose, superscriptions and the highlight.
 *
 * This is the one part of the panel that is not chrome, and the rules it
 * follows come from explicit decisions rather than from taste:
 *
 *   - Context is REAL, READABLE TEXT. Not blurred, not greyed into
 *     illegibility, not reduced to grey bars standing in for words. Someone
 *     memorising a passage is memorising it in its setting, and a placeholder
 *     shape teaches nothing.
 *   - The verse being worked on has to be findable at a glance, so it is
 *     highlighted rather than merely "not dimmed". The distinction matters on
 *     a screen where seven other verses are also fully legible.
 *   - Poetry is laid out as poetry. `VerseText.lines` gives inclusive word
 *     ranges at indent levels 1..3, and a Psalm rendered as a wrapped
 *     paragraph loses the parallelism that is half of what makes Hebrew poetry
 *     memorable in the first place.
 *   - Section headings are NOT rendered. The worker does not send them; the
 *     only heading in the data is `psalmTitle`, which is a superscription -
 *     part of the text, and styled as such.
 *
 * Prose flows across verse boundaries into paragraphs, broken where
 * `paragraphStart` says to break. Rendering every prose verse on its own line
 * would be easier and is what ignoring that flag amounts to.
 */

import type { Line, VerseText } from '../core/types';
import { append, el, textNode } from './dom';

/**
 * Builds the DOM for one word.
 *
 * The exercises need to put an `<input>`, a revealed word or a red "missed"
 * word exactly where a word goes, inside the poetic line it belongs to. Any
 * other arrangement - an answer box below the passage, a separate list of
 * blanks - detaches the answer from its line, which is the layout the blanks
 * exercise was explicitly not to have.
 */
export type WordRenderer = (word: string, index: number) => Node;

export interface VerseRenderOptions {
  /** The verse under exercise. Highlighted, and announced to assistive tech. */
  current?: boolean;
  /** Surrounding context. Still fully legible - just visibly not the subject. */
  muted?: boolean;
  /** Show the chapter:verse label in the margin. Default true. */
  showLabel?: boolean;
  /**
   * Per-word rendering. Omitted for context verses, where the words are
   * inert: a span per word across several verses of context is thousands of
   * nodes bought for nothing.
   */
  renderWord?: WordRenderer;
}

/** Options chosen per verse, so a passage can highlight one of its members. */
export type VerseOptionsFor = (verse: VerseText, index: number) => VerseRenderOptions;

/**
 * Renders a run of verses as reading text.
 *
 * Returns blocks rather than a single wrapper so callers can interleave them -
 * the ordering step needs the placed verses and the picker in one column, and
 * a wrapper element per call would put a nested box around each group.
 */
export function renderPassage(verses: VerseText[], optionsFor: VerseOptionsFor): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  let paragraph: HTMLParagraphElement | null = null;

  verses.forEach((verse, index) => {
    const opts = optionsFor(verse, index);

    // A superscription is a block of its own and therefore ends the paragraph
    // that was in progress. Psalm 51's "To the choirmaster..." cannot sit
    // inline in the middle of the previous psalm's last sentence.
    if (verse.psalmTitle !== null && verse.psalmTitle !== '') {
      paragraph = null;
      blocks.push(el('div', { class: 'sm-superscription', text: verse.psalmTitle }));
    }

    if (verse.lines !== null) {
      paragraph = null;
      blocks.push(renderPoetryVerse(verse, verse.lines, opts));
      return;
    }

    if (paragraph === null || verse.paragraphStart) {
      paragraph = el('p', { class: 'sm-para' });
      blocks.push(paragraph);
    } else {
      // The space between two verses of running prose. A real text node, not
      // CSS margin, so the line breaks where a space is allowed to break.
      paragraph.appendChild(textNode(' '));
    }
    paragraph.appendChild(renderProseVerse(verse, opts));
  });

  return blocks;
}

/** A single verse, standalone - used where there is no surrounding passage. */
export function renderVerseBlock(verse: VerseText, opts: VerseRenderOptions): HTMLElement {
  const wrapper = el('div', { class: 'sm-verse-block' });
  append(wrapper, renderPassage([verse], () => opts));
  return wrapper;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function verseClasses(base: string, opts: VerseRenderOptions): string {
  const classes = [base];
  if (opts.current) classes.push('sm-verse-current');
  if (opts.muted) classes.push('sm-verse-muted');
  return classes.join(' ');
}

/**
 * Attributes that make the highlight mean something to a screen reader.
 *
 * The highlight is a colour, and colour is not available to everyone who uses
 * this panel. `aria-current="step"` says the same thing in the accessibility
 * tree, so "which verse am I on" is answerable without seeing it.
 */
function verseAttrs(verse: VerseText, opts: VerseRenderOptions): Record<string, string> {
  const attrs: Record<string, string> = { 'data-verse-id': String(verse.verseId) };
  if (opts.current) attrs['aria-current'] = 'step';
  return attrs;
}

function renderProseVerse(verse: VerseText, opts: VerseRenderOptions): HTMLElement {
  const span = el('span', {
    class: verseClasses('sm-verse', opts),
    attrs: verseAttrs(verse, opts),
  });
  if (opts.showLabel !== false) span.appendChild(verseLabel(verse));
  appendWords(span, verse, 0, verse.words.length - 1, opts.renderWord);
  return span;
}

function renderPoetryVerse(
  verse: VerseText,
  lines: Line[],
  opts: VerseRenderOptions,
): HTMLElement {
  const block = el('div', {
    class: verseClasses('sm-verse sm-verse-poetry', opts),
    attrs: verseAttrs(verse, opts),
  });

  // `lines` is documented to cover every word without gaps or overlaps, but a
  // module with imperfect markup is a real possibility and a verse that
  // silently loses its last four words would be very hard to notice. Track
  // coverage and emit whatever was left over rather than dropping it.
  let covered = 0;

  lines.forEach((line, index) => {
    const lineEl = el('div', { class: `sm-line sm-line-${line.level}` });
    if (index === 0 && opts.showLabel !== false) lineEl.appendChild(verseLabel(verse));
    appendWords(lineEl, verse, line.start, line.end, opts.renderWord);
    block.appendChild(lineEl);
    covered = Math.max(covered, line.end + 1);
  });

  if (covered < verse.words.length) {
    const tail = el('div', { class: 'sm-line sm-line-1' });
    if (lines.length === 0 && opts.showLabel !== false) tail.appendChild(verseLabel(verse));
    appendWords(tail, verse, covered, verse.words.length - 1, opts.renderWord);
    block.appendChild(tail);
  }

  return block;
}

/** The chapter:verse marker. Presentational, so hidden from assistive tech. */
function verseLabel(verse: VerseText): HTMLElement {
  return el('span', {
    class: 'sm-verse-label',
    text: verse.label,
    attrs: { 'aria-hidden': 'true' },
  });
}

/**
 * Appends words `from`..`to` (inclusive, as `Line` defines them).
 *
 * Without a `renderWord` the whole run becomes one text node. That is not
 * micro-optimisation for its own sake: an ordering step shows every verse
 * placed so far, and a passage of forty verses would otherwise build several
 * thousand spans on every step just to display text nothing interacts with.
 */
function appendWords(
  parent: HTMLElement,
  verse: VerseText,
  from: number,
  to: number,
  renderWord: WordRenderer | undefined,
): void {
  if (to < from) return;

  if (!renderWord) {
    parent.appendChild(textNode(verse.words.slice(from, to + 1).join(' ')));
    return;
  }

  for (let i = from; i <= to; i++) {
    if (i > from) parent.appendChild(textNode(' '));
    parent.appendChild(renderWord(verse.words[i] ?? '', i));
  }
}

/** The default word: a plain span, the unit everything else replaces. */
export function plainWord(word: string): HTMLElement {
  return el('span', { class: 'sm-word', text: word });
}
