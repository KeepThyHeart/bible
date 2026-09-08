import React from 'react';

export interface BreadcrumbSegment {
  label: string;
  path: string; // relative path this segment represents
}

interface NotesBreadcrumbProps {
  segments: BreadcrumbSegment[];
  onNavigate: (path: string) => void;
}

const NotesBreadcrumb: React.FC<NotesBreadcrumbProps> = ({ segments, onNavigate }) => {
  return (
    <div className="flex items-center gap-1 px-3 py-2 text-sm border-b border-border bg-background-warm overflow-x-auto whitespace-nowrap">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <React.Fragment key={segment.path}>
            {index > 0 && (
              <svg className="w-3 h-3 text-text-secondary flex-shrink-0 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            {isLast ? (
              <span className="font-medium text-text-heading" aria-current="true">{segment.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(segment.path)}
                className="text-accent-strong hover:text-accent-strong hover:underline transition-colors"
              >
                {segment.label}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default NotesBreadcrumb;
