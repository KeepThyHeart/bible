import React from 'react';
import type { ModuleRow } from '../../stores/module/moduleRows';
import type { ModuleInstallFilter, ModuleType, DownloadProgress } from '../../stores/module/types';
import { ModuleTableRow, findRowDownload } from './ModuleRow';
import { useTd } from './moduleManagerI18n';

/**
 * Rows for one type tab: the type, the All/Installed/Updates chip and the
 * search text applied to an already merged-and-sorted row list. Order is
 * preserved, so the recommended-first alphabetical order from
 * `mergeAndSortModules` carries through.
 */
export function filterModuleRows(
  rows: ModuleRow[],
  type: ModuleType,
  installFilter: ModuleInstallFilter,
  searchQuery: string
): ModuleRow[] {
  const query = searchQuery.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.module_type !== type) return false;
    if (installFilter === 'installed' && !row.installed) return false;
    if (installFilter === 'updates' && !row.updateAvailable) return false;
    if (query) {
      const description = row.catalogModule?.description ?? row.installedModule?.description ?? '';
      const haystack = `${row.name} ${row.abbreviation} ${description}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export interface ModuleTableProps {
  /** The module-type tab this table renders. */
  type: ModuleType;
  /** All merged rows (any type); the table filters down to `type` itself. */
  rows: ModuleRow[];
  installFilter: ModuleInstallFilter;
  searchQuery: string;
  /** Abbreviation of the selected row, if any. */
  selectedAbbreviation: string | null;
  /** Catalog/installed data is still loading; a spinner shows only while there is nothing to list yet. */
  loading?: boolean;
  /** Network access is off - Install/Update buttons are disabled. */
  offline?: boolean;
  /** Abbreviations with an install/update/uninstall in flight. */
  busyAbbreviations?: ReadonlySet<string>;
  /** Active downloads to show per-row progress. */
  activeDownloads?: DownloadProgress[];
  ariaLabel?: string;
  onSelect: (row: ModuleRow) => void;
  onInstall: (row: ModuleRow) => void;
  onUpdate: (row: ModuleRow) => void;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_DOWNLOADS: DownloadProgress[] = [];

/** Compact table of one module type's rows (name + abbreviation, language, version, size, status). */
export const ModuleTable: React.FC<ModuleTableProps> = ({
  type,
  rows,
  installFilter,
  searchQuery,
  selectedAbbreviation,
  loading = false,
  offline = false,
  busyAbbreviations = EMPTY_SET,
  activeDownloads = EMPTY_DOWNLOADS,
  ariaLabel,
  onSelect,
  onInstall,
  onUpdate,
}) => {
  const td = useTd();
  const visible = filterModuleRows(rows, type, installFilter, searchQuery);

  if (visible.length === 0) {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full" data-testid={`module-table-${type}`}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto mb-4"></div>
            <p className="text-text-secondary">{td('moduleList.loading', 'Loading modules...')}</p>
          </div>
        </div>
      );
    }
    const isUpdates = installFilter === 'updates';
    const isInstalled = installFilter === 'installed';
    return (
      <div className="flex items-center justify-center h-full" data-testid={`module-table-${type}`}>
        <div className="text-center max-w-md px-6" data-testid={`module-table-empty-${type}`}>
          <h3 className="text-lg font-semibold text-text-heading mb-2">
            {isUpdates
              ? td('moduleList.allUpToDate', 'All modules are up to date')
              : isInstalled
                ? td('moduleTable.noneInstalled', 'Nothing installed here yet')
                : td('moduleList.noModulesFound', 'No modules found')}
          </h3>
          <p className="text-text-secondary">
            {isUpdates
              ? td('moduleList.allUpToDateHint', 'You have the latest versions of all your installed modules.')
              : isInstalled
                ? td('moduleTable.noneInstalledHint', 'Switch the filter to All to browse modules you can install.')
                : td(
                    'moduleList.noModulesFoundHint',
                    'Try adjusting your search or filter criteria, or refresh the catalog.'
                  )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4" data-testid={`module-table-${type}`}>
      <table className="w-full text-start border-collapse" aria-label={ariaLabel}>
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-text-tertiary">
            <th scope="col" className="px-4 py-2 text-start font-medium">
              {td('moduleTable.colName', 'Name')}
            </th>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              {td('moduleTable.colLanguage', 'Language')}
            </th>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              {td('moduleTable.colVersion', 'Version')}
            </th>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              {td('moduleTable.colSize', 'Size')}
            </th>
            <th scope="col" className="px-4 py-2 text-end font-medium">
              {td('moduleTable.colStatus', 'Status')}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <ModuleTableRow
              key={row.abbreviation}
              row={row}
              selected={row.abbreviation === selectedAbbreviation}
              busy={busyAbbreviations.has(row.abbreviation)}
              offline={offline}
              activeDownload={findRowDownload(row, activeDownloads)}
              onSelect={onSelect}
              onInstall={onInstall}
              onUpdate={onUpdate}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ModuleTable;
