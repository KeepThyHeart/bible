#!/usr/bin/env node
/**
 * `bible-ext` CLI entry point. Thin shim — all logic lives in `./cli/`.
 */

import { writeFile } from 'node:fs/promises';
import { runCli } from './cli';

void (async (): Promise<void> => {
  const code = await runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  });
  process.exit(code);
})();
