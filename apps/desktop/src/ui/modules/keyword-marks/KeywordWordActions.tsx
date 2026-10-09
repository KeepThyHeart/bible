/**
 * Keyword marks' entries in host views with module slots: the "Mark all ..." items of the verse
 * context menu (`wordMenuItems`) and the Strong's tooltip's "Mark in this chapter" button
 * (`strongsTooltipActions`).
 */
import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import type { StrongsTooltipActionProps, WordMenuItemProps } from '../host/slots';
import { useKeywordMarkStore } from './useKeywordMarkStore';

const MENU_ITEM_CLASS =
  'w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer';

export const KeywordWordMenuItems: React.FC<WordMenuItemProps> = ({ tabId, wordText, wordStrongs, onClose }) => {
  const { t } = useI18n();
  const addKeywordMark = useKeywordMarkStore((s) => s.addMarkFromWord);
  return (
    <>
      <div className="border-t border-border-secondary my-1" role="separator" />
      <button
        onClick={() => {
          void addKeywordMark(tabId, { text: wordText }, 'word');
          onClose();
        }}
        className={MENU_ITEM_CLASS}
        role="menuitem"
        data-testid="menu-mark-word"
      >
        <span className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{t('keywords.menu.markWord', { word: wordText })}</span>
      </button>
      {wordStrongs && (
        <button
          onClick={() => {
            void addKeywordMark(tabId, { text: wordText, strongs: wordStrongs }, 'strongs');
            onClose();
          }}
          className={MENU_ITEM_CLASS}
          role="menuitem"
          data-testid="menu-mark-lemma"
        >
          <span className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t('keywords.menu.markLemma', { strongs: wordStrongs })}</span>
        </button>
      )}
    </>
  );
};

export const KeywordStrongsTooltipAction: React.FC<StrongsTooltipActionProps> = ({ tabId, strongsNumber, onClose }) => {
  const { t } = useI18n();
  const addKeywordMark = useKeywordMarkStore((s) => s.addMarkFromWord);
  return (
    <button
      type="button"
      onClick={() => {
        void addKeywordMark(tabId, { text: strongsNumber, strongs: strongsNumber }, 'strongs');
        onClose();
      }}
      className="mt-1 w-full flex items-center justify-center gap-1 px-2 py-1 rounded border border-border text-xs text-accent-strong hover:bg-accent-light hover:border-accent cursor-pointer transition-colors"
      data-testid="strongs-mark-in-chapter"
    >
      {t('keywords.strongs.markInChapter')}
    </button>
  );
};
