import React, { useState } from 'react';
import { useModuleStore, ModuleCatalog } from '../stores/useModuleStore';
import { useI18n } from '../contexts/useI18n';
import { getModuleCatalogUrl } from '../config/appConfig';

/**
 * RepositorySettings component
 * Allows users to view, add, edit, and remove module repositories.
 */
const RepositorySettings: React.FC = () => {
  // Build-time default catalog URL (BIBLE_MODULE_CATALOG_URL). Unset by
  // default - in that case the URL inputs must not show an example URL that
  // reads like a working default.
  const defaultCatalogUrl = getModuleCatalogUrl();
  const { t } = useI18n();
  const urlPlaceholder = defaultCatalogUrl ?? t('repositorySettings.urlPlaceholder');
  const {
    repositories,
    loadingRepositories,
    addRepository,
    removeRepository,
    updateRepositoryUrl,
    setRepositoryEnabled,
    refreshCatalog,
    loadAvailableModules
  } = useModuleStore();

  // State for editing a repository URL
  const [editingRepoId, setEditingRepoId] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState('');

  // State for adding a new repository
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [newRepoAbbreviation, setNewRepoAbbreviation] = useState('');

  // State for action loading
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const handleStartEdit = (repo: ModuleCatalog) => {
    setEditingRepoId(repo.catalogId);
    setEditUrl(repo.url);
  };

  const handleCancelEdit = () => {
    setEditingRepoId(null);
    setEditUrl('');
  };

  const handleSaveUrl = async (repositoryId: number) => {
    if (!editUrl.trim()) return;
    setActionLoading(repositoryId);
    const success = await updateRepositoryUrl(repositoryId, editUrl.trim());
    if (success) {
      setEditingRepoId(null);
      setEditUrl('');
    }
    setActionLoading(null);
  };

  const handleToggleEnabled = async (repositoryId: number, currentEnabled: boolean) => {
    setActionLoading(repositoryId);
    await setRepositoryEnabled(repositoryId, !currentEnabled);
    setActionLoading(null);
  };

  const handleRefresh = async (repositoryId: number) => {
    setActionLoading(repositoryId);
    await refreshCatalog(repositoryId);
    await loadAvailableModules();
    setActionLoading(null);
  };

  const handleRemove = async (repositoryId: number, repoName: string) => {
    if (!confirm(t('repositorySettings.confirmRemove', { name: repoName }))) return;
    setActionLoading(repositoryId);
    await removeRepository(repositoryId);
    setActionLoading(null);
  };

  const handleAddRepository = async () => {
    if (!newRepoName.trim() || !newRepoUrl.trim()) return;
    setActionLoading(-1); // -1 indicates add action
    const success = await addRepository(
      newRepoName.trim(),
      newRepoUrl.trim(),
      'third_party',
      newRepoAbbreviation.trim() || undefined
    );
    if (success) {
      setShowAddForm(false);
      setNewRepoName('');
      setNewRepoUrl('');
      setNewRepoAbbreviation('');
      await loadAvailableModules();
    }
    setActionLoading(null);
  };

  if (loadingRepositories) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto mb-4" aria-hidden="true"></div>
          <p className="text-text-secondary">{t('repositorySettings.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6" data-testid="repository-settings">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-text-heading mb-2">{t('repositorySettings.heading')}</h3>
          <p className="text-sm text-text-secondary">
            {t('repositorySettings.intro')}
          </p>
        </div>

        {/* Repository list */}
        <div className="space-y-4 mb-6">
          {repositories.map((repo: ModuleCatalog) => (
            <div
              key={repo.catalogId}
              className="border border-border rounded-lg overflow-hidden"
              data-testid={`repository-item-${repo.catalogId}`}
            >
              {/* Repository header */}
              <div className="p-4 bg-surface-secondary border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={repo.isEnabled}
                        onChange={() => handleToggleEnabled(repo.catalogId, repo.isEnabled)}
                        disabled={actionLoading === repo.catalogId}
                        className="rounded border-border text-accent focus:ring-accent"
                      />
                      <span className="font-semibold text-text-heading">{repo.name}</span>
                    </label>
                    {repo.type === 'official' && (
                      <span className="text-xs px-2 py-0.5 bg-accent-soft text-accent-strong rounded">
                        {t('repositorySettings.official')}
                      </span>
                    )}
                    {repo.type === 'third_party' && (
                      <span className="text-xs px-2 py-0.5 bg-background-tertiary text-text-primary rounded">
                        {t('repositorySettings.thirdParty')}
                      </span>
                    )}
                    {!repo.isEnabled && (
                      <span className="text-xs px-2 py-0.5 bg-warning-soft text-warning-text rounded">
                        {t('repositorySettings.disabled')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRefresh(repo.catalogId)}
                      disabled={actionLoading === repo.catalogId || !repo.isEnabled}
                      className="px-3 py-1 text-xs font-medium text-text-primary border border-border rounded hover:bg-background-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('repositorySettings.refreshTitle')}
                      aria-label={t(
                        'repositorySettings.refreshRepositoryLabel',
                        { name: repo.name },
                      )}
                    >
                      {actionLoading === repo.catalogId ? 'Loading...' : 'Refresh'}
                    </button>
                    {repo.type !== 'official' && (
                      <button
                        type="button"
                        onClick={() => handleRemove(repo.catalogId, repo.name)}
                        disabled={actionLoading === repo.catalogId}
                        className="px-3 py-1 text-xs font-medium text-danger border border-danger-border rounded hover:bg-danger-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={t('repositorySettings.removeTitle')}
                        aria-label={t(
                          'repositorySettings.removeRepositoryLabel',
                          { name: repo.name },
                        )}
                      >
                        {t('repositorySettings.remove')}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Repository details */}
              <div className="p-4">
                {/* URL display/edit */}
                <div className="mb-3">
                  <label
                    className="block text-xs font-medium text-text-secondary mb-1"
                    htmlFor={
                      editingRepoId === repo.catalogId
                        ? `repository-url-field-${repo.catalogId}`
                        : undefined
                    }
                  >
                    {t('repositorySettings.repositoryUrl')}
                  </label>
                  {editingRepoId === repo.catalogId ? (
                    <div className="flex gap-2">
                      <input
                        id={`repository-url-field-${repo.catalogId}`}
                        type="text"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                        placeholder={urlPlaceholder}
                        data-testid={`repository-url-input-${repo.catalogId}`}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveUrl(repo.catalogId)}
                        disabled={actionLoading === repo.catalogId}
                        className="px-3 py-1.5 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50"
                      >
                        {t('repositorySettings.save')}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-1.5 text-sm font-medium text-text-secondary border border-border rounded hover:bg-background-hover transition-colors"
                      >
                        {t('repositorySettings.cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm text-text-primary bg-surface-secondary px-3 py-1.5 rounded border border-border truncate">
                        {repo.url}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleStartEdit(repo)}
                        className="px-3 py-1.5 text-sm font-medium text-text-secondary border border-border rounded hover:bg-background-hover transition-colors"
                        title={t('repositorySettings.editUrlTitle')}
                        aria-label={t(
                          'repositorySettings.editUrlForRepositoryLabel',
                          { name: repo.name },
                        )}
                        data-testid={`repository-edit-url-${repo.catalogId}`}
                      >
                        {t('repositorySettings.edit')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div className="flex items-center gap-4 text-xs text-text-tertiary">
                  {repo.lastFetched && (
                    <span>{t('repositorySettings.lastFetched', { date: new Date(repo.lastFetched).toLocaleDateString() })}</span>
                  )}
                  {!repo.lastFetched && (
                    <span className="text-warning">{t('repositorySettings.neverFetched')}</span>
                  )}
                  {repo.abbreviation && (
                    <span>{t('repositorySettings.abbreviation', { value: repo.abbreviation })}</span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {repositories.length === 0 && (
            <div className="text-center py-8 text-text-secondary" data-testid="no-repositories">
              <p>{t('repositorySettings.noRepositories')}</p>
              {/* No catalog URL ships with the app by default, so say what the
                  user can actually do instead of implying one is missing. */}
              <p className="mt-2 text-sm">
                {t('repositorySettings.noneConfigured')}
              </p>
            </div>
          )}
        </div>

        {/* Add repository form */}
        {showAddForm ? (
          <div className="border border-border rounded-lg p-4 bg-surface-secondary" data-testid="add-repository-form">
            <h4 className="text-sm font-semibold text-text-heading mb-3">{t('repositorySettings.addNewHeading')}</h4>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="add-repository-name-field"
                  className="block text-xs font-medium text-text-secondary mb-1"
                >
                  {t('repositorySettings.name')}
                </label>
                <input
                  id="add-repository-name-field"
                  type="text"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  placeholder={t('repositorySettings.namePlaceholder')}
                  className="w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  data-testid="add-repository-name"
                />
              </div>
              <div>
                <label
                  htmlFor="add-repository-url-field"
                  className="block text-xs font-medium text-text-secondary mb-1"
                >
                  {t('repositorySettings.url')}
                </label>
                <input
                  id="add-repository-url-field"
                  type="text"
                  value={newRepoUrl}
                  onChange={(e) => setNewRepoUrl(e.target.value)}
                  placeholder={urlPlaceholder}
                  className="w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  data-testid="add-repository-url"
                />
              </div>
              <div>
                <label
                  htmlFor="add-repository-abbreviation-field"
                  className="block text-xs font-medium text-text-secondary mb-1"
                >
                  {t('repositorySettings.abbreviationOptional')}
                </label>
                <input
                  id="add-repository-abbreviation-field"
                  type="text"
                  value={newRepoAbbreviation}
                  onChange={(e) => setNewRepoAbbreviation(e.target.value)}
                  placeholder={t('repositorySettings.abbreviationPlaceholder')}
                  className="w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleAddRepository}
                  disabled={!newRepoName.trim() || !newRepoUrl.trim() || actionLoading === -1}
                  className="px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="add-repository-submit"
                >
                  {actionLoading === -1 ? 'Adding...' : 'Add Repository'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewRepoName('');
                    setNewRepoUrl('');
                    setNewRepoAbbreviation('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded hover:bg-background-hover transition-colors"
                >
                  {t('repositorySettings.cancel')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 text-sm font-medium text-accent border border-accent rounded hover:bg-accent-light transition-colors flex items-center gap-2"
            data-testid="add-repository-button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('repositorySettings.addRepository')}
          </button>
        )}
      </div>
    </div>
  );
};

export default RepositorySettings;
