import { useTranslation } from 'react-i18next';
import { Popover } from '@bible/ui';
import type { StrongsEntryData } from '../../types';
import { searchStore } from '../../stores/searchStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { keywordMarkStore } from '../../stores/keywordMarkStore';
import { KEYWORD_PANE_ID } from '../../keywordMarks/paneId';

interface StrongsPopupProps {
  entry: StrongsEntryData | null;
  position: { top: number; left: number } | null;
  onClose: () => void;
}

/**
 * Parse a Strong's definition field into structured parts.
 * See StrongsTooltip.tsx for format details.
 */
function parseDefinition(raw: string): { glosses: string; description: string; translit: string; pronunciation: string } {
  let translit = '';
  let pronunciation = '';
  const headerMatch = raw.match(/^\d+\s+\S+\s+(\S+)\s+(\S+)\s*\{([^}]*)\}/);
  if (headerMatch) {
    translit = headerMatch[1];
    pronunciation = headerMatch[3];
  }

  const glossSep = raw.indexOf(':--');
  if (glossSep >= 0) {
    const descPart = raw.substring(0, glossSep).trim();
    const glossPart = raw.substring(glossSep + 3).trim();

    const cleanDesc = descPart
      .replace(/^\d+\s+\S+\s+\S+\s+\S+\s*\{[^}]*\}\s*\n?\s*/i, '')
      .replace(/^\s*\n\s*/, '')
      .trim();

    const cleanGloss = glossPart
      .replace(/\s*see (?:GREEK|HEBREW) for \d+\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.\s*$/, '');

    return { glosses: cleanGloss, description: cleanDesc, translit, pronunciation };
  }

  const cleaned = raw
    .replace(/^\d+\s+\S+\s+\S+\s+\S+\s*\{[^}]*\}\s*\n?\s*/i, '')
    .replace(/\s*see (?:GREEK|HEBREW) for \d+\s*/gi, '')
    .trim();
  return { glosses: '', description: cleaned, translit, pronunciation };
}

export function StrongsPopup({ entry, position, onClose }: StrongsPopupProps) {
  const { t } = useTranslation();

  if (!entry || !position) return null;

  const parsed = parseDefinition(entry.definition);
  const translit = entry.transliteration || parsed.translit;
  const pos = entry.partOfSpeech || '';

  return (
    <Popover
      open
      anchor={{ x: position.left, y: position.top }}
      onClose={onClose}
      portal={false}
      backdrop
      backdropClassName="strongs-popup-overlay"
      className="strongs-popup"
      label={entry.word}
      width={450}
      estimatedHeight={300}
      maxHeight={400}
      offset={0}
      padding={8}
      style={{ width: 'auto', overflowY: 'visible' }}
    >
      <div class="strongs-popup__header">
        <div>
          <span class="strongs-popup__number">{entry.strongsNumber}</span>
          <span class="strongs-popup__word">{entry.word}</span>
        </div>
        <button class="strongs-popup__close" onClick={onClose}>
          <i class="fa-solid fa-xmark" />
        </button>
        <button
          type="button"
          class="strongs-popup__mark-btn"
          onClick={(e) => {
            e.stopPropagation();
            void keywordMarkStore.addMarkFromWord(KEYWORD_PANE_ID, { text: entry.word, strongs: entry.strongsNumber }, 'strongs');
            onClose();
          }}
        >
          <i class="fa-solid fa-highlighter" style={{ marginInlineEnd: '4px' }} />
          {t('keywordMarks.markInChapter')}
        </button>
      </div>
      <div class="strongs-popup__body">
        {translit && (
          <div class="strongs-popup__translit">
            {translit}
            {parsed.pronunciation && parsed.pronunciation !== translit && (
              <span class="strongs-popup__pron"> [{parsed.pronunciation}]</span>
            )}
          </div>
        )}
        {pos && <div class="strongs-popup__pos">{pos}</div>}
        {parsed.glosses && (
          <div class="strongs-popup__glosses">{parsed.glosses}</div>
        )}
        {parsed.description && (
          <div class="strongs-popup__def">{parsed.description}</div>
        )}
        {entry.etymology && (
          <div class="strongs-popup__etym">{t('strongsPopup.etymology')} {entry.etymology}</div>
        )}
      </div>
      <button
        type="button"
        class="strongs-popup__search-btn"
        onClick={(e) => {
          e.stopPropagation();
          searchStore.performSearch(entry.strongsNumber);
          commentaryStore.setRightPaneMode('search');
          onClose();
        }}
      >
        <i class="fa-solid fa-magnifying-glass" style={{ marginInlineEnd: '4px' }} />
        {t('strongsPopup.searchOccurrences')}
      </button>
    </Popover>
  );
}
