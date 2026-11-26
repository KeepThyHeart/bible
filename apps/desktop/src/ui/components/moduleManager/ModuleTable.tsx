import React, { useEffect, useRef } from 'react';
import type { ModuleRow } from '../../stores/module/moduleRows';
import type { ModuleInstallFilter, ModuleType, DownloadProgress } from '../../stores/module/types';
import { ModuleTableRow, findRowDownload, findRowInstallJob, isRowSelectable } from './ModuleRow';
import type { InstallJob } from '../../stores/module/moduleAPI';
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
  /** Background install jobs; each shows as a small progress cell in its row. */
  installJobs?: InstallJob[];
  onCancelInstall?: (jobId: number) => void;
  onRetryInstall?: (jobId: number) => void;
  onDismissInstall?: (jobId: number) => void;
  ariaLabel?: string;
  /**
   * Batch selection. When `onToggleCheck` is given the table gains a checkbox
   * column: a header checkbox (tri-state) over the visible selectable rows and one
   * per selectable row. `checkedAbbreviations` holds the ticked rows.
   */
  checkedAbbreviations?: ReadonlySet<string>;
  /** Checkboxes are disabled (network off, or a batch is running). */
  checkDisabled?: boolean;
  onToggleCheck?: (row: ModuleRow, checked: boolean) => void;
  /** Header checkbox: tick or untick every visible selectable row (`rows`). */
  onToggleAllChecks?: (rows: ModuleRow[], checked: boolean) => void;
  onSelect: (row: ModuleRow) => void;
  onInstall: (row: ModuleRow) => void;
  onUpdate: (row: ModuleRow) => void;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_DOWNLOADS: DownloadProgress[] = [];
const EMPTY_JOBS: InstallJob[] = [];

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
  installJobs = EMPTY_JOBS,
  onCancelInstall,
  onRetryInstall,
  onDismissInstall,
  ariaLabel,
  checkedAbbreviations = EMPTY_SET,
  checkDisabled = false,
  onToggleCheck,
  onToggleAllChecks,
  onSelect,
  onInstall,
  onUpdate,
}) => {
  const td = useTd();
  const visible = filterModuleRows(rows, type, installFilter, searchQuery);
  const showCheckbox = !!onToggleCheck;
  const isCheckable = (row: ModuleRow) => isRowSelectable(row) && !findRowInstallJob(row, installJobs);
  const checkableRows = visible.filter(isCheckable);
  const checkedCount = checkableRows.filter((r) => checkedAbbreviations.has(r.abbreviation)).length;
  const allChecked = checkableRows.length > 0 && checkedCount === checkableRows.length;
  const someChecked = checkedCount > 0 && !allChecked;
  const headerCheckRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckRef.current) headerCheckRef.current.indeterminate = someChecked;
  }, [someChecked, visible.length]);

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
                : offline && !searchQuery
                  ? td('moduleList.offlineTitle', 'Nothing to browse while offline')
                  : td('moduleList.noModulesFound', 'No modules found')}
          </h3>
          <p className="text-text-secondary">
            {isUpdates
              ? td('moduleList.allUpToDateHint', 'You have the latest versions of all your installed modules.')
              : isInstalled
                ? td('moduleTable.noneInstalledHint', 'Switch the filter to All to browse modules you can install.')
                : offline && !searchQuery
                  ? td(
                      'moduleList.offlineHint',
                      'Turn on network access to see what you can install, or install a module from a file you have already downloaded.'
                    )
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
            {showCheckbox && (
              <th scope="col" className="ps-4 py-2 w-8">
                <input
                  ref={headerCheckRef}
                  type="checkbox"
                  data-testid={`module-table-check-all-${type}`}
                  checked={allChecked}
                  disabled={checkDisabled || checkableRows.length === 0}
                  onChange={(e) => onToggleAllChecks?.(checkableRows, e.currentTarget.checked)}
                  aria-label={td('moduleTable.selectAllAria', 'Select all listed modules that can be installed or updated')}
                  aria-checked={someChecked ? 'mixed' : allChecked}
                  className="h-4 w-4 accent-accent"
                />
              </th>
            )}
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
              installJob={findRowInstallJob(row, installJobs)}
              onCancelInstall={onCancelInstall}
              onRetryInstall={onRetryInstall}
              onDismissInstall={onDismissInstall}
              showCheckbox={showCheckbox}
              checkable={isCheckable(row)}
              checked={checkedAbbreviations.has(row.abbreviation)}
              checkDisabled={checkDisabled}
              onToggleCheck={onToggleCheck}
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
