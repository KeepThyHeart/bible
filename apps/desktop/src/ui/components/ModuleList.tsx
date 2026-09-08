import React from 'react';
import { useModuleStore, ModuleViewMode } from '../stores/useModuleStore';
import ModuleCard from './ModuleCard';
import { useI18n } from '../contexts/useI18n';

export interface ModuleListProps {
  viewMode: ModuleViewMode;
}

const ModuleList: React.FC<ModuleListProps> = ({ viewMode }) => {
  const { t } = useI18n();
  const {
    filteredModules,
    installedModules,
    loadingAvailable,
    loadingInstalled
  } = useModuleStore();

  // Determine which modules to show based on view mode
  let modulesToShow: any[] = [];
  let isLoading = false;

  if (viewMode === 'available') {
    modulesToShow = filteredModules;
    isLoading = loadingAvailable;
  } else if (viewMode === 'installed') {
    modulesToShow = installedModules;
    isLoading = loadingInstalled;
  } else if (viewMode === 'updates') {
    // Show only installed modules that have updates available
    modulesToShow = installedModules.filter(m => m.update_available);
    isLoading = loadingInstalled;
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto mb-4"></div>
          <p className="text-text-secondary">{t('moduleList.loading')}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (modulesToShow.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md px-6">
          {viewMode === 'available' && (
            <>
              <svg
                className="w-16 h-16 text-text-tertiary mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h3 className="text-lg font-semibold text-text-heading mb-2">{t('moduleList.noModulesFound')}</h3>
              <p className="text-text-secondary">
                {t('moduleList.noModulesFoundHint')}
              </p>
            </>
          )}
          {viewMode === 'installed' && (
            <>
              <svg
                className="w-16 h-16 text-text-tertiary mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
              <h3 className="text-lg font-semibold text-text-heading mb-2">
                {t('moduleList.noneInstalled')}
              </h3>
              <p className="text-text-secondary">
                {t('moduleList.noneInstalledHint')}
              </p>
            </>
          )}
          {viewMode === 'updates' && (
            <>
              <svg
                className="w-16 h-16 text-success mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h3 className="text-lg font-semibold text-text-heading mb-2">
                {t('moduleList.allUpToDate')}
              </h3>
              <p className="text-text-secondary">
                {t('moduleList.allUpToDateHint')}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Module grid
  return (
    <div className="p-6" data-testid={`module-list-${viewMode}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="module-grid">
        {modulesToShow.map((module) => (
          <ModuleCard
            key={'module_id' in module ? module.module_id : module.abbreviation}
            module={module}
            viewMode={viewMode}
          />
        ))}
      </div>
    </div>
  );
};

export default ModuleList;
