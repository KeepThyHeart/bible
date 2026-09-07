import { truncateAtWordBoundary } from '@bible/core/browser';
import { useViewportPosition } from '../../hooks/useViewportPosition';
import type { StrongsEntryData } from '../../types';

/**
 * How much of each field the hover tooltip shows. The full text is in the
 * dictionary entry (and, on mobile, in `StrongsPopup`).
 *
 * The gloss needs a budget of its own: it is a few words for most entries but
 * runs to 564 characters for `G1722` (ἐν) and 765 at worst, and a tooltip that
 * tall covers the verse the reader is hovering over.
 */
const GLOSS_PREVIEW_LENGTH = 120;
const DESCRIPTION_PREVIEW_LENGTH = 200;

interface StrongsTooltipProps {
  entry: StrongsEntryData | null;
  position: { top: number; left: number } | null;
}

/**
 * Parse a Strong's definition field which often contains everything in one blob:
 * "1722 ἐν ejn en {en} \n a primary preposition... \"in,\" at, by:--about, after..."
 *
 * Returns structured parts for display.
 */
function parseDefinition(raw: string): { glosses: string; description: string } {
  // The ":--" separator typically divides the description from the gloss list
  const glossSep = raw.indexOf(':--');
  if (glossSep >= 0) {
    const descPart = raw.substring(0, glossSep).trim();
    const glossPart = raw.substring(glossSep + 3).trim();

    // Clean up the description: strip the leading "NUMBER WORD translit {pron} \n" prefix
    // which duplicates info already shown in the header
    const cleanDesc = descPart
      .replace(/^\d+\s+\S+\s+\S+\s+\S+\s*\{[^}]*\}\s*\n?\s*/i, '')
      .replace(/^\s*\n\s*/, '')
      .trim();

    // Clean gloss: remove trailing "see GREEK for..." cross-references and extra whitespace
    const cleanGloss = glossPart
      .replace(/\s*see (?:GREEK|HEBREW) for \d+\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.\s*$/, '');

    return {
      glosses: cleanGloss,
      description: cleanDesc,
    };
  }

  // No ":--" separator — just return the cleaned definition
  const cleaned = raw
    .replace(/^\d+\s+\S+\s+\S+\s+\S+\s*\{[^}]*\}\s*\n?\s*/i, '')
    .replace(/\s*see (?:GREEK|HEBREW) for \d+\s*/gi, '')
    .trim();
  return { glosses: '', description: cleaned };
}

export function StrongsTooltip({ entry, position }: StrongsTooltipProps) {
  const tooltipRef = useViewportPosition<HTMLDivElement>(position, [entry?.strongsNumber]);

  if (!entry || !position) return null;

  const { glosses, description } = parseDefinition(entry.definition);

  // Truncate for the tooltip (full version in the dictionary entry / popup)
  const shortGlosses = truncateAtWordBoundary(glosses, GLOSS_PREVIEW_LENGTH).text;
  const shortDesc = truncateAtWordBoundary(description, DESCRIPTION_PREVIEW_LENGTH).text;

  // Extract transliteration from the definition if not provided separately
  // Pattern: "NUMBER GREEK translit pronunciation {pron}"
  let translit = entry.transliteration;
  let pronunciation = '';
  if (!translit) {
    const match = entry.definition.match(/^\d+\s+\S+\s+(\S+)\s+(\S+)\s*\{([^}]*)\}/);
    if (match) {
      translit = match[1];
      pronunciation = match[3];
    }
  }

  // Extract part of speech from description start if not provided
  let pos = entry.partOfSpeech;
  if (!pos && description) {
    // Common patterns: "a primary preposition", "a prolonged form of a primary verb"
    const posMatch = description.match(/^(?:a |an )?(?:primary |prolonged |middle )?\w+(?:\s+\w+)?\b/i);
    if (posMatch && posMatch[0].length < 50) {
      pos = posMatch[0];
    }
  }

  return (
    <div ref={tooltipRef} class="strongs-tooltip" style={{ top: `${position.top}px`, left: `${position.left}px` }}>
      <div class="strongs-tooltip__header">
        <span class="strongs-tooltip__number">{entry.strongsNumber}</span>
        <span class="strongs-tooltip__word">{entry.word}</span>
        {translit && <span class="strongs-tooltip__translit">{translit}</span>}
        {pronunciation && pronunciation !== translit && (
          <span class="strongs-tooltip__pron">[{pronunciation}]</span>
        )}
      </div>
      {pos && <div class="strongs-tooltip__pos">{pos}</div>}
      {shortGlosses && (
        <div class="strongs-tooltip__glosses">{shortGlosses}</div>
      )}
      {shortDesc && (
        <div class="strongs-tooltip__def">{shortDesc}</div>
      )}
    </div>
  );
}
