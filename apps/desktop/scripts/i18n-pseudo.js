#!/usr/bin/env node
/**
 * Thin wrapper kept so `node apps/desktop/scripts/i18n-pseudo.js` keeps
 * working. The generator now lives in `scripts/i18n-pseudo.js` (shared with
 * the web app) and also produces the `xx-rtl` locale (`--rtl`).
 *
 * Without arguments this regenerates desktop's `xx-pseudo` only, exactly as
 * before.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const shared = path.resolve(__dirname, '..', '..', '..', 'scripts', 'i18n-pseudo.js');
const args = process.argv.slice(2);
if (!args.some((a) => a.startsWith('--app='))) args.push('--app=desktop');
const result = spawnSync(process.execPath, [shared, ...args], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
