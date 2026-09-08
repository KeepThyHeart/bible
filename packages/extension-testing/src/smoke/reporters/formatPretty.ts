/**
 * Pretty console reporter for `SmokeSuiteResult`.
 *
 * Returns a plain-ASCII string. The project has no color dependency, so we
 * stick to unicode marks (✓ ✗ ○) that render fine in modern terminals and
 * degrade gracefully elsewhere. The CLI (item 5) is responsible for writing
 * this to stdout.
 */

import type {
  SmokeHookSummary,
  SmokeRecord,
  SmokeSuiteResult,
} from '../runSmokeSuite';

export interface FormatPrettyOptions {
  /**
   * Use ASCII-only status glyphs (`P`/`F`/`S`) instead of unicode marks.
   * Handy for environments where the unicode marks render poorly.
   */
  ascii?: boolean;
  /**
   * Show the first failing input verbatim under each failed hook. Defaults
   * to `true` — this is the whole point of the pretty reporter on a failure.
   */
  showFirstFailure?: boolean;
  /** Override the "now" timestamp in the header. Testing hook. */
  now?: Date;
}

interface Glyphs { pass: string; fail: string; skip: string }
const GLYPHS_UNICODE: Glyphs = { pass: '✓', fail: '✗', skip: '○' };
const GLYPHS_ASCII: Glyphs = { pass: 'P', fail: 'F', skip: 'S' };

export function formatPretty(
  result: SmokeSuiteResult,
  opts: FormatPrettyOptions = {},
): string {
  const glyphs = opts.ascii ? GLYPHS_ASCII : GLYPHS_UNICODE;
  const showFirstFailure = opts.showFirstFailure ?? true;

  const lines: string[] = [];
  lines.push(`${result.extensionId} v${result.extensionVersion}`);

  if (result.perHook.length === 0) {
    lines.push('  (no hooks enumerated)');
  } else {
    const rows = result.perHook.map((h) => formatHookRow(h, glyphs));
    const idWidth = Math.max(...rows.map((r) => r.label.length));
    const countWidth = Math.max(...rows.map((r) => r.counts.length));
    for (let i = 0; i < rows.length; i++) {
      const hook = result.perHook[i] as SmokeHookSummary;
      const row = rows[i] as { label: string; counts: string; timing: string; status: string };
      lines.push(
        `  ${row.status} ${row.label.padEnd(idWidth)}  ${row.counts.padEnd(countWidth)}  ${row.timing}`,
      );
      if (showFirstFailure && hook.firstFailure) {
        lines.push(...formatFailureBlock(hook.firstFailure));
      }
    }
  }

  lines.push('  ' + '─'.repeat(54));
  const { totals } = result;
  const parts = [
    `${totals.passed} passed`,
    `${totals.failed} failed`,
    `${totals.skipped} skipped`,
  ];
  lines.push(
    `  ${parts.join(', ')}   ${formatDuration(totals.durationMs)}   (${totals.hooks} hook${totals.hooks === 1 ? '' : 's'}, ${totals.invocations} invocation${totals.invocations === 1 ? '' : 's'})`,
  );
  return lines.join('\n');
}

interface HookRow {
  status: string;
  label: string;
  counts: string;
  timing: string;
}

function formatHookRow(
  hook: SmokeHookSummary,
  glyphs: Glyphs,
): HookRow {
  const status = hook.failed > 0
    ? glyphs.fail
    : hook.passed === 0 && hook.skipped > 0
      ? glyphs.skip
      : glyphs.pass;
  const counts =
    hook.failed > 0
      ? `${hook.passed}/${hook.total} passed, ${hook.failed} failed`
      : hook.skipped === hook.total && hook.total > 0
        ? `${hook.skipped}/${hook.total} skipped`
        : `${hook.passed}/${hook.total}`;
  const timing = `avg ${formatDuration(hook.avgDurationMs)}`;
  return { status, label: hook.hookId, counts, timing };
}

function formatFailureBlock(failure: SmokeRecord): string[] {
  const reason = failure.failureReason ?? 'fail';
  const out = [
    `      └─ ${reason}: ${failure.message ?? '(no message)'}`,
    `         input: ${failure.input}`,
  ];
  return out;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return `${ms}ms`;
  if (ms < 1) return `${Math.round(ms * 1000) / 1000}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}
