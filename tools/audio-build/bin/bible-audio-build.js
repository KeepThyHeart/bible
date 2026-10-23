#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs');

const dist = path.join(__dirname, '..', 'dist', 'cli.js');
if (!fs.existsSync(dist)) {
  console.error('bible-audio-build: not built yet. Run `pnpm build:core` and `pnpm --filter @bible/audio-build run build` first.');
  process.exit(2);
}
require(dist).main(process.argv.slice(2)).then(
  code => { process.exitCode = code; },
  err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 2; },
);
