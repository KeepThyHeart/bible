/**
 * withBreadcrumb - wraps an IPC handler so each invocation is recorded in
 * the DiagnosticsService ring buffer (channel name + timestamp + error flag).
 *
 * The wrapper does NOT auto-serialize arguments - arguments can contain user
 * content (verse text, note bodies, search queries) that MUST NOT leak into
 * diagnostic reports. If a caller wants a short non-sensitive summary
 * (e.g., `"verse_id=43003016"`), they opt in via `opts.safeArgs`.
 *
 * This is the utility only - existing handlers have not been retrofitted.
 */

import { getDiagnosticsService } from '../ipc/diagnosticsHandlers';

export interface BreadcrumbOptions<Args extends readonly unknown[]> {
  safeArgs?: (args: Args) => string;
}

export function withBreadcrumb<Args extends readonly unknown[], R>(
  channel: string,
  handler: (...args: Args) => R,
  opts: BreadcrumbOptions<Args> = {}
): (...args: Args) => R {
  return (...args: Args): R => {
    const svc = getDiagnosticsService();
    const safeArgs = opts.safeArgs ? opts.safeArgs(args) : undefined;
    try {
      svc?.recordIpc(channel, safeArgs ? { safeArgs } : {});
      return handler(...args);
    } catch (err) {
      svc?.recordIpc(channel, {
        error: true,
        ...(safeArgs ? { safeArgs } : {}),
      });
      throw err;
    }
  };
}
