import React, { useRef, useEffect } from 'react';
import { useFindStore } from '../stores/useFindStore';
import { useI18n } from '../contexts/useI18n';

interface FindBarProps {
  onClose: () => void;
}

const FindBar: React.FC<FindBarProps> = ({ onClose }) => {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    query,
    matches,
    currentMatchIndex,
    isCaseSensitive,
    setQuery,
    nextMatch,
    previousMatch,
    toggleCaseSensitive
  } = useFindStore();

  // Focus input when mounted
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Handle keyboard shortcuts within the find bar
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        previousMatch();
      } else {
        nextMatch();
      }
    } else if (e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) {
        previousMatch();
      } else {
        nextMatch();
      }
    }
  };

  const matchCount = matches.length;
  const currentDisplay = matchCount > 0 ? currentMatchIndex + 1 : 0;

  // Numerals and a slash - nothing to translate, and the live region below is
  // what actually speaks the position.
  const matchSummary = `${currentDisplay} / ${matchCount}`;

  return (
    <div
      className="flex items-center gap-2"
      onKeyDown={handleKeyDown}
      role="search"
      aria-label={t('ui.findBar.placeholder')}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('ui.findBar.placeholder')}
        aria-label={t('ui.findBar.placeholder')}
        aria-describedby="find-bar-match-count"
        className="w-48 px-2 py-1 text-sm border border-border-secondary rounded focus:outline-none focus:ring-2 focus:ring-accent"
      />

      {/*
        Match position is the only thing here worth speaking, and only once the
        user has typed. Polite, so it never cuts across the passage being read.
      */}
      <span
        id="find-bar-match-count"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-sm text-text-secondary min-w-[4rem] text-center"
      >
        {query ? matchSummary : ''}
      </span>

      {/* Navigation buttons */}
      <button
        type="button"
        onClick={previousMatch}
        disabled={matchCount === 0}
        className="p-1 rounded hover:bg-background-hover disabled:opacity-40 disabled:cursor-not-allowed"
        title={t('ui.findBar.previousMatch')}
        aria-label={t('ui.findBar.previousMatch')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      <button
        type="button"
        onClick={nextMatch}
        disabled={matchCount === 0}
        className="p-1 rounded hover:bg-background-hover disabled:opacity-40 disabled:cursor-not-allowed"
        title={t('ui.findBar.nextMatch')}
        aria-label={t('ui.findBar.nextMatch')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Case sensitivity toggle */}
      <button
        type="button"
        onClick={toggleCaseSensitive}
        className={`p-1 rounded text-sm font-mono ${
          isCaseSensitive ? 'bg-accent-soft text-accent-strong' : 'hover:bg-background-hover text-text-secondary'
        }`}
        title={t('ui.findBar.matchCase')}
        aria-label={t('ui.findBar.matchCase')}
        aria-pressed={isCaseSensitive}
      >
        <span aria-hidden="true">Aa</span>
      </button>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="p-1 rounded hover:bg-background-hover"
        title={t('ui.findBar.close')}
        aria-label={t('ui.findBar.close')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export default FindBar;
