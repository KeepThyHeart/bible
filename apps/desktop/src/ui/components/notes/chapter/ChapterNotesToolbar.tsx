import React from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { NotesZoomControl } from '../NotesZoom';

export interface ChapterToolbarBible {
  abbreviation: string;
  name?: string;
}

export interface ChapterNotesToolbarProps {
  title: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  bibles: ChapterToolbarBible[];
  /** '' = the Bible pane's translation. */
  translation: string;
  /** Abbreviation the Bible pane (or the main window) is on, shown in the first option. */
  paneTranslation: string;
  onTranslationChange: (translation: string) => void;
  follow: boolean;
  onToggleFollow: () => void;
  onlyWithNotes: boolean;
  onToggleOnlyWithNotes: () => void;
  onCompile: () => void;
  onSingleNote: () => void;
  /** Pop the pane out to its own window; omitted in a pop-out (nothing further to pop out to). */
  onPopOut?: () => void;
}

const btn =
  'px-2 py-1 text-sm rounded border border-border-secondary hover:bg-background-hover transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed';
const toggleOn = 'bg-accent-light border-accent';

const ChapterNotesToolbar: React.FC<ChapterNotesToolbarProps> = ({
  title, canPrev, canNext, onPrev, onNext, bibles, translation, paneTranslation, onTranslationChange,
  follow, onToggleFollow, onlyWithNotes, onToggleOnlyWithNotes, onCompile, onSingleNote, onPopOut,
}) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border" data-testid="chapter-toolbar">
      <button type="button" className={btn} onClick={onPrev} disabled={!canPrev} aria-label={t('chapterNotes.previousChapter')} title={t('chapterNotes.previousChapter')} data-testid="chapter-prev">
        <span aria-hidden="true" className="rtl-mirror">&#8249;</span>
      </button>
      <h2 className="text-base font-semibold m-0 min-w-16 text-center" title={t('chapterNotes.verseShortcutHint')} data-testid="chapter-title">{title}</h2>
      <button type="button" className={btn} onClick={onNext} disabled={!canNext} aria-label={t('chapterNotes.nextChapter')} title={t('chapterNotes.nextChapter')} data-testid="chapter-next">
        <span aria-hidden="true" className="rtl-mirror">&#8250;</span>
      </button>

      {bibles.length > 1 && (
        <select
          className="px-2 py-1 text-sm rounded border border-border-secondary bg-background-primary max-w-[12rem]"
          value={translation}
          onChange={e => onTranslationChange(e.target.value)}
          aria-label={t('chapterNotes.translation')}
          data-testid="chapter-translation"
        >
          <option value="">{t('chapterNotes.translationBiblePane', { translation: paneTranslation })}</option>
          {bibles.map(b => (
            <option key={b.abbreviation} value={b.abbreviation}>{b.abbreviation}</option>
          ))}
        </select>
      )}

      <button type="button" className={`${btn} ${follow ? toggleOn : ''}`} aria-pressed={follow} onClick={onToggleFollow} data-testid="chapter-follow">
        {t('chapterNotes.follow')}
      </button>
      <button type="button" className={`${btn} ${onlyWithNotes ? toggleOn : ''}`} aria-pressed={onlyWithNotes} onClick={onToggleOnlyWithNotes} data-testid="chapter-only-notes">
        {t('chapterNotes.onlyWithNotes')}
      </button>

      <span className="ms-auto flex items-center gap-2">
        <NotesZoomControl />
        <button type="button" className={btn} onClick={onCompile} data-testid="chapter-compile">{t('chapterNotes.compile')}</button>
        <button type="button" className={btn} onClick={onSingleNote} data-testid="chapter-single">{t('chapterNotes.singleNote')}</button>
        {onPopOut && (
          <button
            type="button"
            className={btn}
            onClick={onPopOut}
            title={t('userNotesPane.popOutTitle')}
            aria-label={t('userNotesPane.popOutTitle')}
            data-testid="chapter-pop-out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        )}
      </span>
    </div>
  );
};

export default ChapterNotesToolbar;
