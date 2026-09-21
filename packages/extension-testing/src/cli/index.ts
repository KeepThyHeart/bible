/**
 * Dispatcher for the `@bible/extension-testing` CLI.
 *
 * Three subcommands, in the order an author meets them: `validate` (is this
 * manifest shippable), `smoke` (does it run), `package` (build the artifact).
 * Exported as pure functions so tests can drive them without touching
 * `process.*`; the `bin` shim in `src/bin.ts` does the binding.
 */

import { runSmokeCommand, type SmokeCommandContext } from './smokeCommand';
import { runValidateCommand } from './validateCommand';
import { runPackageCommand } from './packageCommand';

export { runSmokeCommand, SMOKE_HELP } from './smokeCommand';
export { runValidateCommand, VALIDATE_HELP } from './validateCommand';
export { runPackageCommand, PACKAGE_HELP } from './packageCommand';
export type { SmokeCommandContext } from './smokeCommand';

export const ROOT_HELP = `Usage: bible-ext <command> [options]

Commands:
  validate [path]   Check extension.json and the files it references
  smoke [path]      Run the smoke-test suite against an extension
  package [path]    Build the distributable .zip

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
  if (sub === 'validate') {
    return runValidateCommand(rest, ctx);
  }
  if (sub === 'package') {
    return runPackageCommand(rest, ctx);
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
