import React from 'react';
import { useI18n } from '../contexts/useI18n';

interface TopSearchBarReferenceHintProps {
  referenceText: string;
  referenceTarget: string;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Shows a parsed Bible reference hint in the TopSearchBar dropdown.
 * Displays the formatted reference and a "Navigate to ..." description.
 */
const TopSearchBarReferenceHint: React.FC<TopSearchBarReferenceHintProps> = ({
  referenceText,
  referenceTarget,
  isSelected,
  onClick,
}) => {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`w-full px-3 py-2 text-start transition-colors cursor-pointer ${
        isSelected ? 'bg-accent-soft' : 'hover:bg-accent-light'
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Book icon */}
        <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-accent-strong">{referenceText}</div>
          <div className="text-xs text-text-secondary">
            {t('searchBar.referenceMode.goTo', { reference: referenceTarget })}
          </div>
        </div>
      </div>
    </button>
  );
};

export default TopSearchBarReferenceHint;
