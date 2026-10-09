import React from 'react';
import { groupFromQuery } from '@bible/core/browser';
import { useI18n } from '../../contexts/useI18n';
import type { VerseMenuItemProps } from '../host/slots';
import { revealWordStudyPanel } from './revealWordStudyPanel';

/** The verse context menu's "Study word 'x'" entry, shown when exactly one word is selected. */
export const StudyWordMenuItem: React.FC<VerseMenuItemProps> = ({ selectedWord, onClose }) => {
  const { t } = useI18n();
  if (!selectedWord) return null;
  return (
    <button
      onClick={() => {
        onClose();
        revealWordStudyPanel({ kind: 'group', group: groupFromQuery(selectedWord) });
      }}
      className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors flex items-center gap-2 cursor-pointer"
      role="menuitem"
      data-testid="verse-menu-study-word"
    >
      <span>{t('wordStudy.contextMenuStudyWord', { word: selectedWord })}</span>
    </button>
  );
};
