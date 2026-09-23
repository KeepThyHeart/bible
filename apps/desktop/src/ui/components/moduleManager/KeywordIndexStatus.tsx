/**
 * KeywordIndexStatus.tsx
 *
 * Status badge + Rebuild/Delete actions for one installed module's F8
 * keyword-search index (task 0027 revision 2 backend, wired up in task
 * 0033). Self-contained: fetches the module's `KeywordIndexStatusDto` on
 * mount/module change and owns its own busy/error state for the Rebuild and
 * Delete actions, mirroring `ModuleDetailsPanel`'s own `handleReindex`
 * pattern but kept separate - this is a different index (the sidecar `.kwi`
 * keyword index) from the "Re-index"/`is_indexed` search index above it in
 * the panel, and the two must never be confused for one another.
 *
 * Renders nothing when `moduleId` is not a number (module not installed -
 * the backend addresses a keyword index by numeric module id only).
 */

import React, { useEffect, useRef, useState } from 'react';
import { moduleAPI, type KeywordIndexStatusDto } from '../../stores/module/moduleAPI';
import { useTd } from './moduleManagerI18n';
import { ProgressRing } from '../shared/ProgressRing';
import ConfirmDialog from '../shared/ConfirmDialog';

export interface KeywordIndexStatusProps {
  /** Numeric id of the installed module, or `undefined` when not installed. */
  moduleId: number | undefined;
  /** Module display name, used only in the delete-confirmation copy. */
  moduleName: string;
}

type FetchState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'loaded'; status: KeywordIndexStatusDto }
  | { phase: 'error'; message: string };

type ActionState =
  | { phase: 'idle' }
  | { phase: 'rebuilding' }
  | { phase: 'deleting' }
  | { phase: 'error'; action: 'rebuild' | 'delete'; message: string };

const REBUILDABLE_STATES: ReadonlyArray<KeywordIndexStatusDto['state']> = ['unbuilt', 'stale', 'failed'];
const DELETABLE_STATES: ReadonlyArray<KeywordIndexStatusDto['state']> = ['ready', 'stale'];

const BADGE_CLASSNAME: Record<KeywordIndexStatusDto['state'], string> = {
  unavailable: 'bg-surface-secondary text-text-tertiary',
  unbuilt: 'bg-surface-secondary text-text-secondary',
  building: 'bg-accent-soft text-accent-strong',
  ready: 'bg-success-soft text-success-text',
  stale: 'bg-warning-soft text-warning-text',
  failed: 'bg-danger-soft text-danger-text',
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const KeywordIndexStatus: React.FC<KeywordIndexStatusProps> = ({ moduleId, moduleName }) => {
  const tr = useTd();
  const [fetchState, setFetchState] = useState<FetchState>({ phase: 'idle' });
  const [actionState, setActionState] = useState<ActionState>({ phase: 'idle' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const runRef = useRef(0);

  useEffect(() => {
    const run = ++runRef.current;
    setActionState({ phase: 'idle' });
    setConfirmDelete(false);

    if (typeof moduleId !== 'number') {
      setFetchState({ phase: 'idle' });
      return;
    }

    setFetchState({ phase: 'loading' });
    moduleAPI
      .getKeywordIndexStatus(moduleId)
      .then((status) => {
        if (run !== runRef.current) return;
        setFetchState({ phase: 'loaded', status });
      })
      .catch((error) => {
        if (run !== runRef.current) return;
        setFetchState({ phase: 'error', message: describeError(error) });
      });
  }, [moduleId]);

  if (typeof moduleId !== 'number') return null;

  const status = fetchState.phase === 'loaded' ? fetchState.status : undefined;

  const handleRebuild = async (): Promise<void> => {
    const run = runRef.current;
    setActionState({ phase: 'rebuilding' });
    try {
      const nextStatus = await moduleAPI.rebuildKeywordIndex(moduleId);
      if (run !== runRef.current) return;
      setFetchState({ phase: 'loaded', status: nextStatus });
      setActionState({ phase: 'idle' });
    } catch (error) {
      if (run !== runRef.current) return;
      setActionState({ phase: 'error', action: 'rebuild', message: describeError(error) });
    }
  };

  const handleDelete = async (): Promise<void> => {
    const run = runRef.current;
    setConfirmDelete(false);
    setActionState({ phase: 'deleting' });
    try {
      const nextStatus = await moduleAPI.deleteKeywordIndex(moduleId);
      if (run !== runRef.current) return;
      setFetchState({ phase: 'loaded', status: nextStatus });
      setActionState({ phase: 'idle' });
    } catch (error) {
      if (run !== runRef.current) return;
      setActionState({ phase: 'error', action: 'delete', message: describeError(error) });
    }
  };

  // A build in flight - whether triggered by this session's own Rebuild
  // click, or simply the state the backend already reported (e.g. the
  // automatic post-install build was still running when this panel opened) -
  // shows the same busy indicator and offers neither button (requirement 1).
  const busy =
    actionState.phase === 'rebuilding' ||
    actionState.phase === 'deleting' ||
    status?.state === 'building';

  const showRebuild = !busy && !!status && REBUILDABLE_STATES.includes(status.state);
  const showDelete = !busy && !!status && DELETABLE_STATES.includes(status.state);

  return (
    <div className="pt-3 border-t border-border space-y-2" data-testid="keyword-index-status">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">
          {tr('moduleDetails.keywordIndexLabel', 'Keyword search index')}
        </span>

        {fetchState.phase === 'loading' && (
          <span className="flex items-center gap-1.5 text-xs text-text-tertiary" data-testid="keyword-index-loading">
            <ProgressRing size="small" ariaLabel={tr('moduleDetails.keywordIndex.loading', 'Checking index status...')} />
          </span>
        )}

        {fetchState.phase === 'error' && (
          <span className="text-xs text-danger" role="alert" data-testid="keyword-index-fetch-error">
            {tr('moduleDetails.keywordIndex.error', "Couldn't check index status: {message}", {
              message: fetchState.message,
            })}
          </span>
        )}

        {status && busy && (
          <span className="flex items-center gap-1.5 text-xs text-accent-strong" data-testid="keyword-index-busy">
            <ProgressRing size="small" ariaLabel={tr('moduleDetails.keywordIndex.building', 'Building...')} />
            {tr('moduleDetails.keywordIndex.building', 'Building...')}
          </span>
        )}

        {status && !busy && (
          <span
            className={`text-xs px-2 py-0.5 rounded ${BADGE_CLASSNAME[status.state]}`}
            data-testid="keyword-index-badge"
            data-state={status.state}
            title={status.error ?? undefined}
          >
            {tr(`moduleDetails.keywordIndex.${status.state}`, status.state)}
          </span>
        )}
      </div>

      {(showRebuild || showDelete) && (
        <div className="flex gap-2">
          {showRebuild && (
            <button
              type="button"
              className="flex-1 px-3 py-1.5 text-xs font-medium text-text-primary border border-border rounded hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => void handleRebuild()}
              data-testid="keyword-index-rebuild"
            >
              {tr('moduleDetails.keywordIndex.rebuild', 'Rebuild')}
            </button>
          )}
          {showDelete && (
            <button
              type="button"
              className="flex-1 px-3 py-1.5 text-xs font-medium text-danger border border-danger rounded hover:bg-danger-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => setConfirmDelete(true)}
              data-testid="keyword-index-delete"
            >
              {tr('moduleDetails.keywordIndex.delete', 'Delete index')}
            </button>
          )}
        </div>
      )}

      {actionState.phase === 'error' && (
        <p className="text-xs text-danger break-words" role="alert" data-testid="keyword-index-action-error">
          {actionState.action === 'rebuild'
            ? tr('moduleDetails.keywordIndex.rebuildError', 'Rebuild failed: {message}', {
                message: actionState.message,
              })
            : tr('moduleDetails.keywordIndex.deleteError', 'Delete failed: {message}', {
                message: actionState.message,
              })}
        </p>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={tr('moduleDetails.keywordIndex.confirmDeleteTitle', 'Delete keyword index')}
        message={tr(
          'moduleDetails.keywordIndex.confirmDeleteBody',
          'This removes the keyword search index for {name}. Search will fall back to a slower method for this module until the index is rebuilt.',
          { name: moduleName }
        )}
        confirmLabel={tr('moduleDetails.keywordIndex.delete', 'Delete index')}
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
};

export default KeywordIndexStatus;
