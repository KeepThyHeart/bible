import React, { useCallback, useSyncExternalStore } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { MODULE_PROVENANCE_TEXT } from '../../moduleDescriptions';
import { useModuleProvenance } from './useModuleProvenance';

// ---------------------------------------------------------------------------
// Session-scoped collapse state
// ---------------------------------------------------------------------------
//
// Collapsing is deliberately NOT persisted. A reader who has seen the notice
// once in this sitting does not need it re-stated on every verse, but the next
// launch discloses again - a permanently dismissible provenance notice is the
// same as no notice for anyone who clicks it early. Collapsed still shows the
// provenance label ("Auto-generated summary"), so even the quiet state says
// where the text came from.

const collapsed = new Set<string>();
const collapseListeners = new Set<() => void>();

function subscribeCollapse(listener: () => void): () => void {
  collapseListeners.add(listener);
  return () => collapseListeners.delete(listener);
}

function setCollapsed(moduleAbbr: string, value: boolean): void {
  if (value) collapsed.add(moduleAbbr);
  else collapsed.delete(moduleAbbr);
  for (const listener of collapseListeners) listener();
}

/** Test seam: forget which notices have been collapsed this session. */
export function resetDisclaimerCollapseState(): void {
  collapsed.clear();
  for (const listener of collapseListeners) listener();
}

// ---------------------------------------------------------------------------

export interface DigestDisclaimerProps {
  /** Module abbreviation whose content this notice qualifies. */
  moduleAbbreviation: string | null | undefined;
  /**
   * DOM id, so the content region can point at this notice with
   * `aria-describedby`.
   */
  id?: string;
  /**
   * Offer the collapse control. Off for compact surfaces (the Overview grid)
   * where the notice only renders alongside content the user just expanded.
   */
  collapsible?: boolean;
  /** Extra classes for surface-specific spacing. */
  className?: string;
}

/**
 * Provenance notice for machine-generated module content.
 *
 * Renders nothing for ordinary human-authored modules. Named for parity with
 * the web app's `DigestDisclaimer`, but it covers any module whose metadata
 * declares it generated, not just the SYNTHESIS digest.
 */
const DigestDisclaimer: React.FC<DigestDisclaimerProps> = ({
  moduleAbbreviation,
  id,
  collapsible = true,
  className = '',
}) => {
  const { t } = useI18n();
  const kind = useModuleProvenance(moduleAbbreviation);

  const isCollapsed = useSyncExternalStore(
    subscribeCollapse,
    useCallback(
      () => (moduleAbbreviation ? collapsed.has(moduleAbbreviation) : false),
      [moduleAbbreviation]
    ),
    () => false
  );

  if (!kind || !moduleAbbreviation) return null;

  const text = MODULE_PROVENANCE_TEXT[kind];
  const label = t(text.collapsedKey);
  const regionLabel = t('moduleDisclaimer.regionLabel');

  if (collapsible && isCollapsed) {
    return (
      <button
        type="button"
        id={id}
        data-testid="module-disclaimer-collapsed"
        aria-expanded={false}
        title={t('moduleDisclaimer.expandTitle')}
        onClick={() => setCollapsed(moduleAbbreviation, false)}
        className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-info-text hover:bg-info-soft transition-colors ${className}`}
      >
        <InfoIcon />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <aside
      role="note"
      id={id}
      aria-label={regionLabel}
      data-testid="module-disclaimer"
      className={`flex items-start gap-2 rounded border-s-2 border-info-border bg-info-soft px-3 py-2 text-xs ${className}`}
    >
      <span className="mt-0.5 flex-shrink-0 text-info-text">
        <InfoIcon />
      </span>
      <div className="min-w-0 flex-1 text-start">
        <p className="font-medium text-info-text">
          {t(text.provenanceKey)}
        </p>
        <p className="mt-0.5 text-text-secondary">
          {t(text.cautionKey)}
        </p>
      </div>
      {collapsible && (
        <button
          type="button"
          data-testid="module-disclaimer-collapse"
          aria-expanded
          aria-label={t('moduleDisclaimer.collapseTitle')}
          title={t('moduleDisclaimer.collapseTitle')}
          onClick={() => setCollapsed(moduleAbbreviation, true)}
          className="flex-shrink-0 rounded p-0.5 text-info-text opacity-70 hover:opacity-100 transition-opacity"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </aside>
  );
};

/** Small "information" glyph. Decorative - the text carries the meaning. */
const InfoIcon: React.FC = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

export default DigestDisclaimer;
