/**
 * Dispatcher for the `@bible/extension-testing` CLI.
 *
 * Single subcommand today (`smoke`) but structured so future commands slot
 * in alongside. Exported as a pure function so tests can drive it without
 * touching `process.*`; the `bin` shim in `src/bin.ts` does the binding.
 */

import { runSmokeCommand, type SmokeCommandContext } from './smokeCommand';

export { runSmokeCommand, SMOKE_HELP } from './smokeCommand';
export type { SmokeCommandContext } from './smokeCommand';

export const ROOT_HELP = `Usage: bible-ext <command> [options]

Commands:
  smoke [path]    Run the smoke-test suite against an extension

Run "bible-ext <command> --help" for details on a specific command.
`;

export async function runCli(
  argv: readonly string[],
  ctx: SmokeCommandContext,
): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === '--help' || sub === '-h') {
    ctx.stdout(ROOT_HELP);
    return sub === undefined ? 1 : 0;
  }
  if (sub === 'smoke') {
    return runSmokeCommand(rest, ctx);
  }
  if (sub === '--version' || sub === '-v') {
    // Kept minimal — package.json is the source of truth; callers who need
    // it can read it themselves. Dispatcher just exits cleanly.
    ctx.stdout('bible-ext\n');
    return 0;
  }
  ctx.stderr(`bible-ext: unknown command "${sub}"\n`);
  ctx.stderr(ROOT_HELP);
  return 1;
}
