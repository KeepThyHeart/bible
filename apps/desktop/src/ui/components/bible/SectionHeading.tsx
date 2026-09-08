import React from 'react';

/**
 * Chapter prefaces and section headings (Psalm superscriptions, "The
 * Beatitudes", etc.) can arrive in two shapes. Standard, Reading, Study and
 * Parallel Bible views all handle both the same way - see
 * `docs/features/bible-pane.md` ("Chapter prefaces and section headings").
 */

/**
 * `verse.verse === 0` - a literal preface verse, as legacy v1-style modules
 * store it. No verse-number affordance should be rendered; the verse gets
 * italic/secondary "preface" styling instead of ordinary body text.
 */
export function isPrefaceVerse(verse: { verse: number }): boolean {
  return verse.verse === 0;
}

/**
 * `verse.formatting.sectionHeading` - how Module Format v2 actually carries
 * this content (`bible_verse.formatting.block.heading` in the database,
 * projected to `sectionHeading` for the renderer). The heading rides on the
 * verse that follows it (typically verse 1) rather than being stored as its
 * own verse.
 */
export function getSectionHeading(verse: { formatting?: { sectionHeading?: string } }): string | undefined {
  return verse.formatting?.sectionHeading;
}

/** Shared italic/secondary styling applied to a preface verse's text. */
export const PREFACE_TEXT_CLASSNAME = 'italic text-text-secondary text-sm';

interface SectionHeadingBlockProps {
  text: string;
  className?: string;
}

/**
 * Renders a Psalm superscription / section heading immediately above the
 * verse (or paragraph) it rides on. `className` lets each call site control
 * its own spacing without affecting the shared italic/secondary look.
 */
export const SectionHeadingBlock: React.FC<SectionHeadingBlockProps> = ({ text, className = '' }) => (
  <div className={`text-sm italic text-text-secondary ${className}`.trim()}>{text}</div>
);
