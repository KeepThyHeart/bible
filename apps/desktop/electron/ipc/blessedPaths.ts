/**
 * Blessed-path registry (non-extension security hardening).
 *
 * ## Problem
 * The absolute-path IPC channels (`file-notes:read-note-absolute`,
 * `file-notes:save-note-absolute`, `module:install-from-path`) take an absolute
 * path from the renderer. If they simply read/wrote it, a compromised or
 * exploited renderer could read or write ANY file on disk via these channels -
 * the relative-path handlers funnel through `BibleNotesFileService.safeResolve`,
 * but an absolute path has no such natural containment.
 *
 * ## Approach
 * The legitimate reason those channels take an absolute path is that the user
 * chose the path through a *native* file dialog (`dialog.showOpenDialog` /
 * `dialog.showSaveDialog`) shown by the main process. Only the main process can
 * show those dialogs, so only the main process ever learns a legitimate
 * absolute path. We record every path the user picks through such a dialog in
 * this in-memory allowlist ("blesses" it). The absolute read/save/install
 * handlers then refuse any path that was NOT blessed this session (i.e. a path
 * the renderer fabricated rather than one the user actually chose).
 *
 * The registry is intentionally in-memory only and scoped to the running main
 * process. It is shared across every BrowserWindow (main + detached), so a path
 * blessed while opening a document in one window stays usable for that
 * document's autosave in a detached window during the same app run. It is
 * deliberately NOT persisted: after an app restart the user must re-open an
 * external file through a dialog before the app will touch it again.
 *
 * Paths are normalized (resolved + case-folded on Windows) so that equivalent
 * spellings of the same file compare equal.
 */
import path from 'path';

/** Absolute, normalized paths the user has authorized this session. */
const blessed = new Set<string>();

/**
 * Canonicalize a path for comparison: resolve to an absolute path and, on
 * case-insensitive filesystems (Windows), lower-case it so `C:\Foo` and
 * `c:\foo` are treated as the same file.
 */
export function normalizeBlessedPath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Record a path the user selected through a main-process file dialog as
 * authorized for absolute-path read/write/install this session. No-op for
 * empty input.
 */
export function blessPath(p: string | undefined | null): void {
  if (!p) return;
  blessed.add(normalizeBlessedPath(p));
}

/**
 * Return true if `p` was previously blessed (chosen via a main-process dialog)
 * this session.
 */
export function isPathBlessed(p: string | undefined | null): boolean {
  if (!p) return false;
  return blessed.has(normalizeBlessedPath(p));
}

/**
 * Return true if `child` is `parent` itself or lives underneath it. Used to let
 * absolute paths that fall inside the user's own configured notes directory
 * through without a dialog (they are already reachable via the relative-path
 * handlers). Both paths are normalized before comparison.
 */
export function isPathWithin(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  const c = normalizeBlessedPath(child);
  const base = normalizeBlessedPath(parent);
  if (c === base) return true;
  const rel = path.relative(base, c);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Clear all blessed paths. Intended for tests; not used in normal operation.
 */
export function clearBlessedPaths(): void {
  blessed.clear();
}
