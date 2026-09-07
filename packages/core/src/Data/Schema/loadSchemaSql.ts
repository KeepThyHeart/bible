/**
 * Reader for the schema files under `sql/schemas/`.
 *
 * A few tables are defined identically in more than one schema -- `module_info`,
 * `verse_link`, the module form of `schema_version`. Each has exactly one
 * definition, under `sql/schemas/shared/`, and the schemas that carry it pull it
 * in with an include directive rather than repeating it:
 *
 * ```sql
 * -- @include ../shared/module_info.sql
 * ```
 *
 * The directive is a SQL comment, so a schema file remains readable -- and
 * diffable -- as plain SQL. It is not, however, executable as-is: run it through
 * {@link loadSchemaSql} first.
 *
 * ```typescript
 * db.exec(loadSchemaSql('sql/schemas/initial/BibleTranslation.sql'));
 * ```
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Raised when a schema file cannot be assembled. */
export class SchemaLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaLoadError';
  }
}

/**
 * A whole-line `-- @include <path>` directive. Anchored to the start of a line so
 * the token can be discussed in prose comments without being expanded, and
 * whole-line so an include is never buried at the end of a statement.
 */
const INCLUDE_DIRECTIVE = /^[ \t]*--[ \t]*@include[ \t]+(\S+)[ \t]*$/gmu;

/** Guards against an include cycle turning into unbounded recursion. */
const MAX_INCLUDE_DEPTH = 8;

/**
 * Read a schema file and expand its `-- @include` directives, recursively.
 *
 * Included paths are resolved relative to the file containing the directive, so
 * a fragment can include another fragment without knowing who pulled it in.
 *
 * @param schemaPath Absolute or cwd-relative path to the schema file.
 * @returns Executable SQL: the file's own text with every directive replaced by
 *          the referenced file's contents.
 * @throws {SchemaLoadError} if a file cannot be read, or if includes nest deeper
 *         than {@link MAX_INCLUDE_DEPTH} (which a cycle always will).
 */
export function loadSchemaSql(schemaPath: string): string {
  return expand(resolve(schemaPath), 0, []);
}

function expand(absolutePath: string, depth: number, stack: readonly string[]): string {
  if (depth > MAX_INCLUDE_DEPTH) {
    throw new SchemaLoadError(
      `include depth exceeded ${MAX_INCLUDE_DEPTH} at ${absolutePath}; the chain was ` +
        `${[...stack, absolutePath].join(' -> ')}, which usually means an include cycle`
    );
  }

  let source: string;
  try {
    source = readFileSync(absolutePath, 'utf8');
  } catch (cause) {
    const via = stack.length === 0 ? '' : ` (included from ${stack[stack.length - 1]!})`;
    throw new SchemaLoadError(`cannot read schema file ${absolutePath}${via}: ${String(cause)}`);
  }

  const directory = dirname(absolutePath);
  INCLUDE_DIRECTIVE.lastIndex = 0;
  return source.replace(INCLUDE_DIRECTIVE, (_match, target: string) =>
    expand(resolve(directory, target), depth + 1, [...stack, absolutePath]).replace(/\n+$/u, '')
  );
}
