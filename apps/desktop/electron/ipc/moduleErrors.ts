import { IpcKnownError } from './result';

/**
 * Classification of a module lookup that came back empty.
 *   - `ok`          - metadata row present and the file exists (the failure is something else)
 *   - `no_metadata` - no `module_metadata` row for this abbreviation (really not installed)
 *   - `file_missing`- row present but the module file is gone from disk
 */
export type ModuleDiagnosis = 'ok' | 'no_metadata' | 'file_missing';

export interface DiagnosableLoader {
  diagnose(abbreviation: string): { status: ModuleDiagnosis; databasePath?: string };
}

/**
 * Build the classified error for a module that could not be loaded.
 * `file_missing` -> `module_missing` (the renderer shows a "module file missing"
 * state and does not retry); everything else keeps the legacy `not_found` code
 * and the caller's own message.
 */
export function missingModuleError(
  loader: DiagnosableLoader,
  abbreviation: string,
  notFoundMessage: string
): IpcKnownError {
  const d = loader.diagnose(abbreviation);
  if (d.status === 'file_missing') {
    return new IpcKnownError(
      'module_missing',
      `Module file missing: ${abbreviation}${d.databasePath ? ` (${d.databasePath})` : ''}`
    );
  }
  return new IpcKnownError('not_found', notFoundMessage);
}

/**
 * Wrap a logger so the core loader's "Module not found" / "Database not found"
 * lines are written once per distinct message per session (the core negative
 * cache re-logs every 30 s). Other messages pass through untouched.
 */
export function dedupeMissingModuleLogs<L extends { error: (...a: any[]) => void }>(logger: L): L {
  const seen = new Set<string>();
  return new Proxy(logger, {
    get(target, prop, receiver) {
      if (prop === 'error') {
        return (message: unknown, ...args: unknown[]) => {
          if (typeof message === 'string' && /(Database|Module) not found/.test(message)) {
            if (seen.has(message)) return;
            if (seen.size > 500) seen.clear();
            seen.add(message);
          }
          return target.error(message, ...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
