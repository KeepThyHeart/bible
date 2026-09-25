#!/usr/bin/env node

/**
 * module-digest.js - CLI wrapper around `@bible/core`'s `computeContentSha256`
 * (task 0027, "Module Format v2", revision 2, subtask F3): print the
 * canonical content digest for one module `.db` file.
 *
 * Requires the package to be built first (`npm run build` in `packages/core`)
 * - it runs against the compiled `dist/`, the same way any other consumer of
 * `@bible/core` does. There is no TS-execution step wired into this package's
 * `scripts/` (see `copy-assets.js`, the only other script here before this
 * one, which is plain JS for the same reason - a compiled `dist/asset` is
 * what other tooling in this repo already expects a `packages/core/scripts/*`
 * script to work from).
 *
 * Opens the module READ-ONLY via `better-sqlite3` directly (this repo root's
 * build, the same one `apps/desktop/scripts/validate-module.js` uses - not a
 * platform's compiled binding) - this script never writes.
 *
 * Usage:
 *   node scripts/module-digest.js <path-to-module.db> [--type=<moduleType>]
 *
 * `<moduleType>` is read from `module_info.module_type` when the file has one
 * (every real module does) and normalised through the same alias table the
 * app uses (`'topical'` -> `'topical_index'`, `'xref'` -> `'cross_reference'`
 * - see `normalizeModuleType`). Pass `--type=<moduleType>` to override, or for
 * a database with no `module_info` at all.
 *
 * Prints just the 64-char lowercase hex digest to stdout, nothing else - so
 * it is pipeable/scriptable (`node scripts/module-digest.js foo.db | ...`).
 * Anything else - usage help, the file path being checked - goes to stderr.
 * Exit code 1 on any failure (bad usage, missing file, unrecognised module
 * type, a compressed cell this build has no codec for, ...).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const {
  computeContentSha256,
  resolveModuleCodec,
  createNodeCodecRegistry,
  normalizeModuleType,
  isModuleType,
} = require('../dist');

/**
 * Minimal `ISql` (see `Data/Core/ISql.ts`) over `better-sqlite3`, read-only.
 * Deliberately not `TestSqliteProvider` - that class lives under
 * `src/__tests__/helpers/`, is not part of the package's build output, and is
 * for the test suite only. This is the CLI's own, much smaller equivalent.
 */
class ReadOnlySql {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
  }

  queryOne(sql, params) {
    return this.db.prepare(sql).get(...bind(params));
  }

  queryAll(sql, params) {
    return this.db.prepare(sql).all(...bind(params));
  }

  execute() {
    throw new Error('module-digest.js opens modules read-only; execute() is not supported.');
  }

  transaction(fn) {
    return fn();
  }

  close() {
    this.db.close();
  }

  isOpen() {
    return this.db.open;
  }

  getDatabasePath() {
    return this.dbPath;
  }
}

/** Positional binds spread; a named-bind object is passed as one argument. */
function bind(params) {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

function parseArgs(argv) {
  const positional = [];
  let type = null;
  for (const arg of argv) {
    if (arg.startsWith('--type=')) {
      type = arg.slice('--type='.length);
    } else {
      positional.push(arg);
    }
  }
  return { dbPath: positional[0], type };
}

function fail(message) {
  console.error(`module-digest: ${message}`);
  process.exitCode = 1;
}

/** `--type` if given (normalised); otherwise `module_info.module_type`. */
function resolveType(sql, explicitType) {
  const raw = explicitType || readModuleTypeColumn(sql);
  if (!raw) {
    throw new Error(
      "could not determine the module's type: no module_info.module_type in this file, " +
        'and no --type=<moduleType> given.'
    );
  }
  const normalized = normalizeModuleType(raw);
  if (!isModuleType(normalized)) {
    throw new Error(`unrecognised module type '${raw}'`);
  }
  return normalized;
}

function readModuleTypeColumn(sql) {
  const columns = sql.queryAll('PRAGMA table_info(module_info)').map(row => row.name);
  if (!columns.includes('module_type')) {
    return null;
  }
  const row = sql.queryOne('SELECT module_type FROM module_info WHERE info_id = 1');
  return row ? row.module_type : null;
}

function main() {
  const { dbPath, type } = parseArgs(process.argv.slice(2));
  if (!dbPath) {
    fail('usage: node scripts/module-digest.js <path-to-module.db> [--type=<moduleType>]');
    return;
  }

  const resolvedPath = path.resolve(dbPath);
  if (!fs.existsSync(resolvedPath)) {
    fail(`no such file: ${resolvedPath}`);
    return;
  }

  const sql = new ReadOnlySql(resolvedPath);
  try {
    const moduleType = resolveType(sql, type);
    const codec = resolveModuleCodec(sql, createNodeCodecRegistry());
    const digest = computeContentSha256(sql, moduleType, codec);
    console.log(digest);
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  } finally {
    sql.close();
  }
}

main();
