#!/usr/bin/env node
// Builds the extension UI kit into dist/kit/ so `loadUiKit()` can evaluate it in an extension's own
// tests. Same esbuild options as the desktop app's kit (packages/ui/scripts/build-kit.mjs).
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKit } from '../../ui/scripts/build-kit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { js, css } = await buildKit({ outdir: resolve(root, 'dist/kit') });
console.log(`extension-testing: kit ${js.length} B js, ${css.length} B css -> dist/kit/`);
