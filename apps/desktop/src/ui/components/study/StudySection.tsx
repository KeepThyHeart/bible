import React from 'react';

export interface StudySectionProps {
  /** Section heading. Rendered in caps - pass it in sentence case. */
  title: string;
  /** Optional second line under the heading, e.g. which module the data is from. */
  subtitle?: string;
  /** Item count shown beside the heading. Hidden when zero. */
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/**
 * Collapsible section of the Study pane.
 *
 * Ported from the web app's `StudySection` (`apps/web/src/components/
 * StudyPane/StudySection.tsx` and `_study-pane.scss`): a full-width tinted
 * header band in caps, an accent chevron, an optional subtitle naming the
 * source, and - once expanded - a sticky header so the reader keeps their place
 * while scrolling a long section. A bare text button would give the sections
 * no visual separation at all.
 *
 * Collapse state itself lives in the Study store (per panel), not here.
 */
const StudySection: React.FC<StudySectionProps> = ({
  title,
  subtitle,
  count,
  collapsed,
  onToggle,
  children,
}) => (
  <section style={{ marginBottom: collapsed ? '2px' : '12px' }}>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '8px 12px',
        border: 'none',
        borderTop: '1px solid var(--theme-border-primary)',
        borderBottom: '1px solid var(--theme-border-primary)',
        backgroundColor: 'var(--theme-bg-secondary, rgba(0,0,0,0.04))',
        color: 'var(--theme-text-primary)',
        cursor: 'pointer',
        textAlign: 'start',
        // Sticky only while open: a collapsed header has nothing to anchor.
        position: collapsed ? 'static' : 'sticky',
        top: 0,
        zIndex: 5,
      }}
    >
      <span
        aria-hidden="true"
        className="rtl-mirror"
        style={{
          fontSize: '10px',
          width: '12px',
          flexShrink: 0,
          color: 'var(--theme-accent-primary)',
        }}
      >
        {collapsed ? '▶' : '▼'}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {title}
          {count !== undefined && count > 0 && (
            <span style={{ fontWeight: 400, color: 'var(--theme-text-secondary)' }}>
              {' '}({count})
            </span>
          )}
        </span>
        {subtitle && (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 400,
              lineHeight: 1.3,
              color: 'var(--theme-text-secondary)',
            }}
          >
            {subtitle}
          </span>
        )}
      </span>
    </button>
    {!collapsed && <div style={{ padding: '8px 12px 12px' }}>{children}</div>}
  </section>
);

export default StudySection;
