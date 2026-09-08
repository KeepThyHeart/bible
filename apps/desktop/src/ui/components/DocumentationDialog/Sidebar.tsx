import { DocSection, TFn } from './types';
import { SvgIcon } from './SvgIcon';

export interface DocumentationSidebarProps {
  t: TFn;
  sections: DocSection[];
  totalSectionCount: number;
  activeSectionId: string;
  searchQuery: string;
  collapsed: boolean;
  onToggleCollapsed: (collapsed: boolean) => void;
  onSelectSection: (sectionId: string) => void;
}

export function DocumentationSidebar({
  t,
  sections,
  totalSectionCount,
  activeSectionId,
  searchQuery,
  collapsed,
  onToggleCollapsed,
  onSelectSection,
}: DocumentationSidebarProps) {
  if (collapsed) {
    return (
      <div className="flex-shrink-0 border-e border-border bg-surface-secondary flex flex-col items-center pt-2">
        <button
          type="button"
          onClick={() => onToggleCollapsed(false)}
          className="p-1.5 text-text-muted hover:text-text-secondary hover:bg-background-hover rounded transition-colors"
          title={t('documentationDialog.expandSidebar')}
          aria-label={t('documentationDialog.expandSidebar')}
          aria-expanded={false}
        >
          <svg className="w-4 h-4" aria-hidden="true" focusable="false" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <nav
      className="w-56 flex-shrink-0 border-e border-border bg-surface-secondary overflow-y-auto"
      aria-label={t('documentationDialog.headerTitle')}
    >
      <ul className="py-2">
        {sections.map((section) => {
          const isActive = section.id === activeSectionId;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => onSelectSection(section.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-start transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent font-medium border-e-2 border-accent'
                    : 'text-text-secondary hover:bg-background-hover hover:text-text-primary'
                }`}
              >
                <SvgIcon
                  path={section.icon}
                  className={`flex-shrink-0 ${isActive ? 'text-accent' : 'text-text-muted'}`}
                />
                <span className="truncate">{section.title}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Sidebar collapse button */}
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={() => onToggleCollapsed(true)}
          aria-expanded={true}
          className="w-full flex items-center justify-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-secondary hover:bg-background-hover rounded transition-colors"
        >
          <svg className="w-3.5 h-3.5" aria-hidden="true" focusable="false" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
          <span>{t('documentationDialog.collapseSidebar')}</span>
        </button>
      </div>

      {/* Search results count */}
      {searchQuery && (
        <div className="px-4 py-2 text-xs text-text-muted border-t border-border" role="status" aria-live="polite">
          {t(
            'documentationDialog.searchMatchCount',
            { matched: sections.length, total: totalSectionCount, },
          )}
        </div>
      )}
    </nav>
  );
}
