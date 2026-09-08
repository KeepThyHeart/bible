#!/usr/bin/env node
/**
 * `bible-ext-smoke` CLI — dedicated bin for the `smoke` subcommand so
 * extension authors can wire `"smoke": "bible-ext-smoke"` in their own
 * `package.json` without repeating the subcommand name.
 */

import { writeFile } from 'node:fs/promises';
import { runSmokeCommand } from './cli';

void (async (): Promise<void> => {
  const code = await runSmokeCommand(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  });
  process.exit(code);
})();
