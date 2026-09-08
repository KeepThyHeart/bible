import { RefObject } from 'react';
import { DocSection, TFn } from './types';
import { SvgIcon } from './SvgIcon';
import { renderBlock } from './BlockRenderer';
import { tElements } from '../../utils/tElements';
import { getAppConfig } from '../../config/appConfig';

export interface DocumentationContentViewProps {
  t: TFn;
  sections: DocSection[];
  contentRef: RefObject<HTMLDivElement | null>;
  sectionRefs: RefObject<Record<string, HTMLDivElement | null>>;
  searchQuery: string;
  onClearSearch: () => void;
}

export function DocumentationContentView({
  t,
  sections,
  contentRef,
  sectionRefs,
  searchQuery,
  onClearSearch,
}: DocumentationContentViewProps) {
  // Branding is a build-time setting, not a translatable literal. It reaches
  // the renderer over the preload bridge (`window.electron.appConfig`) and
  // falls back to the bundler defines when the bridge is absent, so no new IPC
  // is needed. `appVersion` is empty only when neither the define nor
  // BIBLE_APP_VERSION was supplied; the footer then drops the version clause.
  const { productName, appVersion } = getAppConfig();

  return (
    /*
      The panel scrolls, so it must be reachable by keyboard - a mouse-only
      scroll container strands anyone who cannot use a pointer. tabIndex={0}
      (never a positive value) puts it in the natural tab order.
    */
    <div
      ref={contentRef as RefObject<HTMLDivElement>}
      className="flex-1 overflow-y-auto px-8 py-6"
      tabIndex={0}
      role="region"
      aria-label={t('documentationDialog.headerTitle')}
    >
      {sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-text-muted">
          <svg className="w-12 h-12 mb-3" aria-hidden="true" focusable="false" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p className="text-sm">{t('documentationDialog.noSectionsMatch', { query: searchQuery })}</p>
          <button
            type="button"
            onClick={onClearSearch}
            className="mt-2 text-sm text-accent hover:underline"
          >
            {t('documentationDialog.clearSearch')}
          </button>
        </div>
      ) : (
        sections.map((section) => (
          <div
            key={section.id}
            ref={(el) => {
              if (sectionRefs.current) {
                sectionRefs.current[section.id] = el;
              }
            }}
            className="mb-10"
          >
            {/* Section title */}
            <div className="flex items-center gap-2.5 mb-4 pb-2 border-b border-border">
              <SvgIcon path={section.icon} className="text-accent" />
              <h2 className="text-xl font-semibold text-text-heading">{section.title}</h2>
            </div>

            {/* Section content blocks */}
            {section.content.map((block, i) => renderBlock(block, i))}
          </div>
        ))
      )}

      {/* Footer */}
      {sections.length > 0 && (
        <div className="mt-8 pt-4 border-t border-border text-center text-xs text-text-muted">
          <p>
            {appVersion === ''
              ? productName
              : t('documentationDialog.footerVersion', { productName, version: appVersion })}
          </p>
          <p className="mt-1">
            {tElements(t, 'documentationDialog.footerPressToClose', {
              key: (
                <kbd
                  dir="ltr"
                  className="px-1 py-0.5 bg-background-tertiary rounded border border-border text-text-secondary font-mono text-xs"
                >
                  {t('documentationDialog.footerEscKey')}
                </kbd>
              ),
            })}
          </p>
        </div>
      )}
    </div>
  );
}
