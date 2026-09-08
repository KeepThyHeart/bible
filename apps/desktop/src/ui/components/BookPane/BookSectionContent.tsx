import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { sanitizeHtml } from '../../utils/sanitize';
import { BookSection, BookSectionSummary, BookTab } from '../../stores/useBookStore';
import { preprocessBookContent } from './preprocessBookContent';
import {
  buildBreadcrumbs,
  renderSectionTree,
  NavSectionInfo,
} from './sectionTreeRenderers';

interface BookSectionContentProps {
  activeTab: BookTab;
  currentSection: BookSection;
  childSections: BookSectionSummary[];
  sectionSummaries: BookSectionSummary[];
  prevSectionInfo: NavSectionInfo | null;
  nextSectionInfo: NavSectionInfo | null;
  navigateToSection: (abbreviation: string, sectionId: number) => void;
  /** Back to the book's Home page - its contents and search. */
  navigateToHome: (abbreviation: string) => void;
}

/** Rendered body for a single book section: breadcrumbs, header, child contents, body, prev/next, full TOC. */
export const BookSectionContent: React.FC<BookSectionContentProps> = ({
  activeTab,
  currentSection,
  childSections,
  sectionSummaries,
  prevSectionInfo,
  nextSectionInfo,
  navigateToSection,
  navigateToHome,
}) => {
  const { t } = useI18n();

  return (
    <div className="px-xl py-lg max-w-4xl mx-auto">
      {/* Breadcrumbs */}
      {sectionSummaries.length > 0 && (() => {
        const breadcrumbs = buildBreadcrumbs(currentSection, sectionSummaries);

        return breadcrumbs.length > 0 && (
          <div className="flex items-center flex-wrap mb-md text-sm">
            {/*
              Home is the book's contents page, not its first section. Jumping
              to whichever section happens to be first - usually a title page -
              would make "Home" and "the beginning of the text" the same
              destination, and neither of them the outline.
            */}
            <button
              onClick={() => navigateToHome(activeTab.abbreviation)}
              className="flex items-center hover:underline transition-colors whitespace-nowrap text-text-secondary hover:text-text-primary"
              title={t('bookPane.goToBookHomeTitle')}
              data-testid="book-home-breadcrumb"
            >
              📚 {t('bookPane.homeBreadcrumb')}
            </button>

            {(
              <>
                <span className="text-text-secondary mx-xs rtl-mirror">›</span>
                {breadcrumbs.map((crumb, index) => (
                  <React.Fragment key={crumb.section_id}>
                    {index > 0 && (
                      <span className="text-text-secondary mx-xs rtl-mirror">›</span>
                    )}
                    <button
                      onClick={() => navigateToSection(activeTab.abbreviation, crumb.section_id)}
                      className={`hover:underline transition-colors whitespace-nowrap ${
                        index === breadcrumbs.length - 1
                          ? 'text-accent font-semibold'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                      title={crumb.title}
                    >
                      {crumb.section_number ? `${crumb.section_number}. ` : ''}
                      {crumb.title}
                    </button>
                  </React.Fragment>
                ))}
              </>
            )}
          </div>
        );
      })()}

      <div className="mb-lg">
        <div className="flex items-start justify-between mb-sm">
          <div className="flex-1">
            {currentSection.section_number && (
              <div className="text-sm text-text-secondary mb-xs">
                {t('bookPane.sectionLabel', { number: currentSection.section_number })}
              </div>
            )}
            <h2 className="text-2xl font-semibold text-text-heading">
              {currentSection.title}
            </h2>
          </div>
          {currentSection.word_count && (
            <div className="text-xs text-text-secondary ms-md">
              {t('bookPane.wordCount', { count: currentSection.word_count.toLocaleString(), })}
            </div>
          )}
        </div>
      </div>

      {/* Child Sections List (if any) */}
      {childSections.length > 0 && (
        <div className="mb-lg border-s-4 border-accent ps-md py-sm bg-background-warm">
          <h3 className="text-lg font-semibold text-text-heading mb-sm">
            {t('bookPane.contentsHeading')}
          </h3>
          {renderSectionTree(childSections, activeTab.abbreviation, sectionSummaries, navigateToSection, t)}
        </div>
      )}

      {/* Section Content */}
      <div
        className="prose prose-lg max-w-none leading-relaxed"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(preprocessBookContent(currentSection.content, currentSection.title)) }}
      />

      {/* Navigation links at end of section */}
      {(prevSectionInfo || nextSectionInfo) && (
        <div className="flex items-center justify-between mt-2xl pt-lg border-t border-border">
          {prevSectionInfo ? (
            <button
              onClick={() => navigateToSection(activeTab.abbreviation, prevSectionInfo.section_id)}
              className="flex items-start gap-sm text-start hover:bg-background-warm p-md rounded transition-colors max-w-[45%]"
            >
              <span className="text-2xl text-text-secondary rtl-mirror">←</span>
              <div className="flex-1">
                <div className="text-xs text-text-secondary mb-xs">{t('bookPane.previousLabel')}</div>
                <div className="text-sm text-accent hover:underline">
                  {prevSectionInfo.section_number && (
                    <span className="text-text-secondary me-xs">{prevSectionInfo.section_number}.</span>
                  )}
                  {prevSectionInfo.title}
                </div>
              </div>
            </button>
          ) : (
            <div></div>
          )}

          {nextSectionInfo ? (
            <button
              onClick={() => navigateToSection(activeTab.abbreviation, nextSectionInfo.section_id)}
              className="flex items-start gap-sm text-end hover:bg-background-warm p-md rounded transition-colors max-w-[45%]"
            >
              <div className="flex-1">
                <div className="text-xs text-text-secondary mb-xs">{t('bookPane.nextLabel')}</div>
                <div className="text-sm text-accent hover:underline">
                  {nextSectionInfo.section_number && (
                    <span className="text-text-secondary me-xs">{nextSectionInfo.section_number}.</span>
                  )}
                  {nextSectionInfo.title}
                </div>
              </div>
              <span className="text-2xl text-text-secondary rtl-mirror">→</span>
            </button>
          ) : (
            <div></div>
          )}
        </div>
      )}

      {/*
        The full table of contents is deliberately not appended to the first
        section. Home is its own page and *is* the contents, so repeating them
        under the title page would be a second copy of the same list in a worse
        place.
      */}
    </div>
  );
};
