import React, { useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import {
  useModuleStore,
  ModuleMetadata,
  CatalogModule,
  ModuleViewMode
} from '../stores/useModuleStore';

export interface ModuleCardProps {
  module: CatalogModule | ModuleMetadata;
  viewMode: ModuleViewMode;
}

const ModuleCard: React.FC<ModuleCardProps> = ({ module, viewMode: _viewMode }) => {
  const { t } = useI18n();
  const { installModule, uninstallModule, updateModule, installedModules } = useModuleStore();
  const [isLoading, setIsLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = React.useId();

  // Determine if this is a catalog module or installed module
  const isCatalogModule = !('module_id' in module && typeof module.module_id === 'number');
  const catalogModule = module as CatalogModule;
  const installedModule = module as ModuleMetadata;

  // Check if already installed (for catalog modules)
  const isInstalled = isCatalogModule
    ? installedModules.some((m) => m.abbreviation === catalogModule.abbreviation)
    : true;

  // Module type icon
  const getModuleTypeIcon = () => {
    const iconClass = 'w-5 h-5';
    switch (module.module_type) {
      case 'bible':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
          </svg>
        );
      case 'commentary':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              fillRule="evenodd"
              d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z"
              clipRule="evenodd"
            />
          </svg>
        );
      case 'dictionary':
      case 'lexicon':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              fillRule="evenodd"
              d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z"
              clipRule="evenodd"
            />
          </svg>
        );
      case 'book':
      case 'topical_index':
      case 'tag_graph':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
          </svg>
        );
      case 'cross_reference':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" />
          </svg>
        );
      case 'devotional':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
              clipRule="evenodd"
            />
          </svg>
        );
      default:
        return null;
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  // Handle install
  const handleInstall = async () => {
    if (!isCatalogModule) return;
    setIsLoading(true);
    const success = await installModule(catalogModule.module_id);
    setIsLoading(false);
    if (success) {
      // Success feedback handled by store
    }
  };

  // Handle uninstall
  const handleUninstall = async () => {
    if (isCatalogModule) return;
    if (!confirm(`Are you sure you want to uninstall "${module.name}"?`)) return;

    setIsLoading(true);
    await uninstallModule(installedModule.module_id, false);
    setIsLoading(false);
  };

  // Handle update
  const handleUpdate = async () => {
    if (isCatalogModule) return;
    setIsLoading(true);
    await updateModule(installedModule.module_id);
    setIsLoading(false);
  };

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden hover:shadow-md transition-shadow" data-testid={`module-card-${module.abbreviation}`}>
      {/* Header */}
      <div className="p-4 border-b border-border bg-surface-secondary">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <div className="text-accent mt-1">{getModuleTypeIcon()}</div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-text-heading break-words">
                {module.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-text-secondary font-mono">
                  {module.abbreviation}
                </span>
                {isCatalogModule && module.language_code && module.language_code !== 'en' && (
                  <span className="text-xs px-2 py-0.5 bg-accent-soft text-accent-strong rounded">
                    {module.language_code.toUpperCase()}
                  </span>
                )}
                {isCatalogModule && catalogModule.recommended && (
                  <span className="text-xs px-2 py-0.5 bg-success-soft text-success-text rounded flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    {t('moduleCard.recommended')}
                  </span>
                )}
                {!isCatalogModule && installedModule.update_available && (
                  <span className="text-xs px-2 py-0.5 bg-warning-soft text-warning-text rounded flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {t('moduleCard.updateAvailable')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <p className="text-sm text-text-secondary line-clamp-2 mb-3">{module.description}</p>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-xs text-text-tertiary mb-3">
          <div className="flex items-center gap-1">
            <span>{t('moduleCard.versionLabel')}</span>
            <span className="font-medium">{module.version}</span>
          </div>
          {isCatalogModule && (
            <div className="flex items-center gap-1">
              <span>{t('moduleCard.sizeLabel')}</span>
              <span className="font-medium">
                {formatFileSize(catalogModule.download_size_bytes)}
              </span>
            </div>
          )}
          {!isCatalogModule && installedModule.usage_count > 0 && (
            <div className="flex items-center gap-1">
              <span>{t('moduleCard.usesLabel')}</span>
              <span className="font-medium">{installedModule.usage_count}</span>
            </div>
          )}
        </div>

        {/* Details toggle */}
        {isCatalogModule && (catalogModule.author || catalogModule.license) && (
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            aria-expanded={showDetails}
            aria-controls={detailsId}
            className="text-xs text-accent hover:underline mb-2"
          >
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
        )}

        {/* Expanded details */}
        {showDetails && isCatalogModule && (
          <div id={detailsId} className="text-xs text-text-secondary space-y-1 mb-3 p-3 bg-surface-secondary rounded">
            {catalogModule.author && (
              <div>
                <span className="font-medium">{t('moduleCard.authorLabel')}</span> {catalogModule.author}
              </div>
            )}
            {catalogModule.publisher && (
              <div>
                <span className="font-medium">{t('moduleCard.publisherLabel')}</span> {catalogModule.publisher}
              </div>
            )}
            {catalogModule.year_published && (
              <div>
                <span className="font-medium">{t('moduleCard.yearLabel')}</span> {catalogModule.year_published}
              </div>
            )}
            {catalogModule.license && (
              <div>
                <span className="font-medium">{t('moduleCard.licenseLabel')}</span> {catalogModule.license}
              </div>
            )}
            {catalogModule.features && catalogModule.features.length > 0 && (
              <div>
                <span className="font-medium">{t('moduleCard.featuresLabel')}</span>{' '}
                {catalogModule.features.join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {/* Primary action buttons */}
          <div className="flex gap-2">
          {isCatalogModule && !isInstalled && (
            <button
              type="button"
              onClick={handleInstall}
              disabled={isLoading}
              className="flex-1 px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-text-on-accent" aria-hidden="true"></div>
                  {t('moduleCard.installing')}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path
                      fillRule="evenodd"
                      d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {t('moduleCard.install')}
                </>
              )}
            </button>
          )}
          {isCatalogModule && isInstalled && (
            <div className="flex-1 px-4 py-2 text-sm font-medium text-success-text bg-success-soft rounded flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              {t('moduleCard.installed')}
            </div>
          )}
          {!isCatalogModule && installedModule.update_available && (
            <button
              type="button"
              onClick={handleUpdate}
              disabled={isLoading}
              className="flex-1 px-4 py-2 text-sm font-medium text-text-on-accent bg-warning rounded hover:bg-warning/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-text-on-accent" aria-hidden="true"></div>
                  {t('moduleCard.updating')}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path
                      fillRule="evenodd"
                      d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {t('moduleCard.update')}
                </>
              )}
            </button>
          )}
          {!isCatalogModule && !installedModule.update_available && (
            <button
              type="button"
              onClick={handleUninstall}
              disabled={isLoading}
              className="flex-1 px-4 py-2 text-sm font-medium text-danger border border-danger rounded hover:bg-danger-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-danger" aria-hidden="true"></div>
                  {t('moduleCard.uninstalling')}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path
                      fillRule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {t('moduleCard.uninstall')}
                </>
              )}
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModuleCard;
