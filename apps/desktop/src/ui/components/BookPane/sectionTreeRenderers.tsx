import React from 'react';
import { BookSection, BookSectionSummary } from '../../stores/useBookStore';

export type NavSectionInfo = { section_id: number; title: string; section_number?: string };

/** The `t` these renderers need. They are plain functions, so it is threaded in rather than hooked. */
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/** Get the first top-level section ID of the book (used for "home" navigation). */
export function getFirstSectionId(allSummaries: BookSectionSummary[]): number | null {
  const topLevelSections = allSummaries
    .filter(s => !s.parent_section_id)
    .sort((a, b) => {
      if (a.section_number && b.section_number) {
        return a.section_number.localeCompare(b.section_number, undefined, { numeric: true });
      }
      return (a.section_id || 0) - (b.section_id || 0);
    });

  return topLevelSections.length > 0 ? topLevelSections[0].section_id : null;
}

/** Build breadcrumb trail by walking up parent chain from current section. */
export function buildBreadcrumbs(
  section: BookSection | null,
  allSummaries: BookSectionSummary[]
): NavSectionInfo[] {
  if (!section || !section.section_id) return [];

  const breadcrumbs: NavSectionInfo[] = [];
  let currentId: number | undefined = section.section_id;

  while (currentId) {
    const current = allSummaries.find(s => s.section_id === currentId);
    if (!current) break;

    breadcrumbs.unshift({
      section_id: current.section_id,
      title: current.title,
      section_number: current.section_number,
    });

    currentId = current.parent_section_id;
  }

  return breadcrumbs;
}

/** Check if current section is the first top-level section of the book. */
export function isFirstSection(
  section: BookSection | null,
  allSummaries: BookSectionSummary[]
): boolean {
  if (!section || !section.section_id) return false;

  const topLevelSections = allSummaries
    .filter(s => !s.parent_section_id)
    .sort((a, b) => {
      if (a.section_number && b.section_number) {
        return a.section_number.localeCompare(b.section_number, undefined, { numeric: true });
      }
      return (a.section_id || 0) - (b.section_id || 0);
    });

  return topLevelSections.length > 0 && topLevelSections[0].section_id === section.section_id;
}

/** Recursively render section tree as nested <ul>. */
export function renderSectionTree(
  sections: BookSectionSummary[],
  abbreviation: string,
  allSummaries: BookSectionSummary[],
  navigateToSection: (abbreviation: string, sectionId: number) => void,
  t: TranslateFn,
  depth: number = 0
): React.ReactNode {
  if (sections.length === 0) return null;

  const hasFullSummaries = allSummaries.length > 0;

  return (
    <ul className={`space-y-xs ${depth > 0 ? 'ms-lg mt-xs' : ''}`}>
      {sections.map((section) => {
        const children = hasFullSummaries
          ? allSummaries.filter(s => s.parent_section_id === section.section_id)
          : [];

        return (
          <li key={section.section_id}>
            <button
              onClick={() => navigateToSection(abbreviation, section.section_id)}
              className="text-start w-full px-sm py-xs rounded hover:bg-background transition-colors text-accent hover:underline"
            >
              {section.section_number && (
                <span className="text-text-secondary me-sm">
                  {section.section_number}.
                </span>
              )}
              <span>{section.title}</span>
              {section.word_count && (
                <span className="text-xs text-text-secondary ms-sm">
                  {t(
                    'bookPane.wordCountParenthetical',
                    { count: section.word_count.toLocaleString(), },
                  )}
                </span>
              )}
            </button>
            {hasFullSummaries && children.length > 0 &&
              renderSectionTree(children, abbreviation, allSummaries, navigateToSection, t, depth + 1)}
          </li>
        );
      })}
    </ul>
  );
}

/** Render full table of contents starting from top-level sections. */
export function renderCompleteTableOfContents(
  abbreviation: string,
  allSummaries: BookSectionSummary[],
  navigateToSection: (abbreviation: string, sectionId: number) => void,
  t: TranslateFn
): React.ReactNode {
  const topLevelSections = allSummaries.filter(s => !s.parent_section_id);
  return renderSectionTree(topLevelSections, abbreviation, allSummaries, navigateToSection, t, 0);
}
