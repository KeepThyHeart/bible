import { useState, useRef, useCallback } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

const STORAGE_PREFIX = 'bible-study-section-';

interface StudySectionProps {
  id: string;
  label: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  children: ComponentChildren;
}

export function StudySection({ id, label, subtitle, defaultExpanded = false, children }: StudySectionProps) {
  const sectionRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_PREFIX + id);
      if (stored !== null) return stored === '1';
    } catch { /* ignore */ }
    return defaultExpanded;
  });

  const toggle = useCallback(() => {
    setExpanded(prev => {
      const next = !prev;
      try { sessionStorage.setItem(STORAGE_PREFIX + id, next ? '1' : '0'); } catch { /* ignore */ }
      if (!next) {
        // On collapse, scroll header back into view
        requestAnimationFrame(() => {
          sectionRef.current?.scrollIntoView({ block: 'nearest' });
        });
      }
      return next;
    });
  }, [id]);

  return (
    <div ref={sectionRef} class="study-pane__section">
      <div
        class={`study-pane__section-label${expanded ? ' study-pane__section-label--sticky' : ''}`}
        onClick={toggle}
      >
        <i class={`fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'} study-pane__section-chevron`} />
        <span class="study-pane__section-titles">
          {label}
          {subtitle && <span class="study-pane__section-subtitle">{subtitle}</span>}
        </span>
      </div>
      {expanded && (
        <div class="study-pane__section-body">
          {children}
        </div>
      )}
    </div>
  );
}
