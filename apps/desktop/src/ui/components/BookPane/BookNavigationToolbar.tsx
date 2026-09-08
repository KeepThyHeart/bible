import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { BookSection } from '../../stores/useBookStore';
import { NavSectionInfo } from './sectionTreeRenderers';
import PassageSettingsMenu from '../bible/PassageSettingsMenu';
import {
  PaneToolbar,
  PaneToolbarButton,
  ChevronStartIcon,
  ChevronEndIcon,
  ChevronUpIcon,
} from '../shared/PaneToolbar';

interface BookNavigationToolbarProps {
  isLoading: boolean;
  currentSection: BookSection;
  /** Where > would go, or null at the end of the book (the button then disables). */
  nextSectionInfo: NavSectionInfo | null;
  /** Where < would go, or null at the start of the book. */
  prevSectionInfo: NavSectionInfo | null;
  onPrevious: () => void;
  onNext: () => void;
  onUp: () => void;
}

/**
 * A book's toolbar: previous / next / up, and text settings.
 *
 * Wears the Bible pane's furniture (`PaneToolbar`) rather than a row of rounded
 * pills, and SVG icons rather than the glyph arrows `< > ^`: those are literal
 * text characters, so they render at whatever the font gives them and sit a
 * pixel off the baseline next to the Bible pane's SVGs.
 *
 * There is deliberately no "Contents" button on the right. It would open the
 * table of contents, which the Home tab *is* - a searchable, expandable tree -
 * so it would be a second door onto the same room, and the breadcrumb Home is
 * already the first.
 */
export const BookNavigationToolbar: React.FC<BookNavigationToolbarProps> = ({
  isLoading,
  currentSection,
  nextSectionInfo,
  prevSectionInfo,
  onPrevious,
  onNext,
  onUp,
}) => {
  const { t } = useI18n();

  return (
    <PaneToolbar
      ariaLabel={t('bookPane.toolbarLabel')}
      testId="book-toolbar"
      trailing={<PassageSettingsMenu paneKey="book" />}
    >
      {/*
        Disabled at the ends of the book, with the destination in the tooltip.
        Left permanently enabled, the arrows simply stopped moving at the last
        section, which reads as a hang rather than as "end of book".
      */}
      <PaneToolbarButton
        onClick={onPrevious}
        disabled={isLoading || !prevSectionInfo}
        label={prevSectionInfo
          ? t('bookPane.previousSectionTo', { title: prevSectionInfo.title })
          : t('bookPane.previousSectionTitle')}
        testId="book-prev-section"
      >
        <ChevronStartIcon />
      </PaneToolbarButton>
      <PaneToolbarButton
        onClick={onNext}
        disabled={isLoading || !nextSectionInfo}
        label={nextSectionInfo
          ? t('bookPane.nextSectionTo', { title: nextSectionInfo.title })
          : t('bookPane.nextSectionTitle')}
        testId="book-next-section"
      >
        <ChevronEndIcon />
      </PaneToolbarButton>
      {/*
        Always offered, the book's first section included. From a top-level
        section it goes to the book's Home page - its contents and search -
        which is somewhere to go from anywhere.
      */}
      <PaneToolbarButton
        onClick={onUp}
        disabled={isLoading}
        strongDivider
        label={currentSection.parent_section_id
          ? t('bookPane.parentSectionTitle')
          // "Home", the same word the breadcrumb uses for the same destination.
          : t('bookPane.homeSectionTitle')}
        testId="book-up-section"
      >
        <ChevronUpIcon />
      </PaneToolbarButton>
    </PaneToolbar>
  );
};
