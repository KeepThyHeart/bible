import React, { useEffect, useMemo, useState } from 'react';
import { BookSectionSummary } from '../../stores/useBookStore';
import { useI18n } from '../../contexts/useI18n';

/**
 * A book's table of contents as an expandable tree.
 *
 * Lifted out of `BookTreeView` (the modal) so the Home tab can show the same
 * tree inline. They had been one component, which meant the only way to see a
 * book's structure was to open a dialog over the top of it and then dismiss it
 * again to read anything.
 *
 * Expansion is deliberately shallow by default - root level only. A large
 * reference work has thousands of sections, and expanding all of them turns the
 * outline the reader came for into a flat wall.
 */

export interface BookSectionTreeProps {
  summaries: BookSectionSummary[];
  /** Highlighted as the reader's current place. Null on the Home page. */
  currentSectionId: number | null;
  onSelectSection: (sectionId: number) => void;
  /** Section ids to force open, on top of whatever the reader has expanded. */
  forceExpanded?: ReadonlySet<number>;
}

interface TreeNode {
  section: BookSectionSummary;
  children: TreeNode[];
  level: number;
}

/** Build the parent -> children hierarchy the tree renders from. */
export function buildSectionTree(summaries: BookSectionSummary[]): TreeNode[] {
  const childrenMap = new Map<number | undefined, BookSectionSummary[]>();

  summaries.forEach(section => {
    // Normalize null to undefined for consistent handling
    const parentId = section.parent_section_id === null ? undefined : section.parent_section_id;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(section);
  });

  const build = (parentId: number | undefined, level: number): TreeNode[] =>
    (childrenMap.get(parentId) ?? []).map(section => ({
      section,
      children: build(section.section_id, level + 1),
      level,
    }));

  return build(undefined, 0);
}

/**
 * Every ancestor of `sectionId`, so the tree can open the path down to it.
 * Returns an empty set when the section is not in the summaries.
 */
export function ancestorsOf(
  summaries: BookSectionSummary[],
  sectionId: number | null,
): Set<number> {
  const expanded = new Set<number>();
  if (sectionId === null) return expanded;

  const current = summaries.find(s => s.section_id === sectionId);
  if (!current) return expanded;

  let parentId = current.parent_section_id;
  // A malformed book could cycle; the visited set is what stops it hanging.
  while (parentId && !expanded.has(parentId)) {
    expanded.add(parentId);
    parentId = summaries.find(s => s.section_id === parentId)?.parent_section_id;
  }
  return expanded;
}

const BookSectionTree: React.FC<BookSectionTreeProps> = ({
  summaries,
  currentSectionId,
  onSelectSection,
  forceExpanded,
}) => {
  const { t } = useI18n();
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  const tree = useMemo(() => buildSectionTree(summaries), [summaries]);

  // Open the path down to wherever the reader currently is, so the tree does
  // not present them with a closed outline and no sign of their own place.
  useEffect(() => {
    if (currentSectionId && summaries.length > 0) {
      setExpandedSections(ancestorsOf(summaries, currentSectionId));
    }
  }, [currentSectionId, summaries]);

  const toggleExpand = (sectionId: number): void => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const renderTreeNode = (node: TreeNode): React.ReactNode => {
    const isExpanded = expandedSections.has(node.section.section_id)
      || forceExpanded?.has(node.section.section_id) === true;
    const hasChildren = node.children.length > 0;
    const isCurrent = node.section.section_id === currentSectionId;
    const indent = node.level * 20; // 20px per level

    return (
      <div key={node.section.section_id}>
        {/*
          The disclosure toggle and the "open this section " action are siblings,
          not nested. A button inside a button is invalid HTML and leaves the
          inner control unreachable for assistive tech.
        */}
        <div
          className={`
            flex items-center py-sm px-md transition-colors
            ${isCurrent ? 'bg-accent/20 font-semibold' : 'hover:bg-background-warm'}
          `}
          style={{ paddingInlineStart: `${indent + 16}px` }}
        >
          {/* Expand/collapse icon. A fixed-width spacer stands in for it on a
              leaf, so titles at the same level line up with each other. */}
          {hasChildren ? (
            <button
              type="button"
              className="me-sm text-text-secondary hover:text-text-primary"
              aria-expanded={isExpanded}
              aria-label={
                isExpanded
                  ? t('ui.bookTreeView.collapseSection', { title: node.section.title, })
                  : t('ui.bookTreeView.expandSection', { title: node.section.title, })
              }
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.section.section_id);
              }}
            >
              <span aria-hidden="true" className="rtl-mirror">{isExpanded ? '▼' : '▶'}</span>
            </button>
          ) : (
            <span aria-hidden="true" className="me-sm inline-block w-[1ch]" />
          )}

          <button
            type="button"
            className="flex-1 text-start flex items-center gap-sm cursor-pointer"
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onSelectSection(node.section.section_id)}
          >
            {node.section.section_number && (
              <span className="text-xs text-text-secondary font-mono">
                {node.section.section_number}
              </span>
            )}
            <span className={`text-sm ${isCurrent ? 'text-accent' : 'text-text-primary'}`}>
              {node.section.title}
            </span>
            {node.section.word_count && (
              <span className="text-xs text-text-secondary ms-auto">
                {t(
                  'ui.bookTreeView.wordCount',
                  { count: node.section.word_count.toLocaleString(), },
                )}
              </span>
            )}
          </button>
        </div>

        {hasChildren && isExpanded && <div>{node.children.map(renderTreeNode)}</div>}
      </div>
    );
  };

  return <div className="py-sm">{tree.map(renderTreeNode)}</div>;
};

export default BookSectionTree;
