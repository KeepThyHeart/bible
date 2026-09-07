import { MigrationGuard, MigrationStatement, MigrationTarget } from './MigrationTypes';

/**
 * Parser for migration `.sql` files.
 *
 * Splitting on `;` is not good enough: a `CREATE TRIGGER` body contains
 * semicolons inside `BEGIN ... END`, and semicolons also appear inside string
 * literals and comments. This parser tracks string literals, quoted
 * identifiers, line and block comments, and `BEGIN`/`CASE` ... `END` nesting.
 *
 * It also collects `-- @skip-if:` guard directives that appear in the comment
 * lines immediately preceding a statement, and the `-- @database:` /
 * `-- @description:` header directives.
 */

/** Result of parsing a migration file. */
export interface ParsedMigration {
  target: MigrationTarget;
  description?: string;
  statements: MigrationStatement[];
}

const HEADER_DATABASE = /^\s*@database\s*:\s*(main|user|both)\s*$/i;
const HEADER_DESCRIPTION = /^\s*@description\s*:\s*(.+?)\s*$/i;
const GUARD =
  /^\s*@skip-if\s*:\s*(table-exists|table-missing|column-exists|column-missing)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\s*$/i;

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

/**
 * Turn the text of a `-- ...` comment into a guard, if it is one.
 * Returns undefined for ordinary prose comments.
 */
function parseGuard(commentText: string): MigrationGuard | undefined {
  const match = GUARD.exec(commentText);
  if (!match) return undefined;

  const kind = match[1]!.toLowerCase() as MigrationGuard['kind'];
  const table = match[2]!;
  const column = match[3];

  const wantsColumn = kind === 'column-exists' || kind === 'column-missing';
  if (wantsColumn && !column) {
    throw new Error(`Guard "${kind}" requires <table>.<column>, got "${commentText.trim()}"`);
  }
  if (!wantsColumn && column) {
    throw new Error(`Guard "${kind}" takes a table only, got "${commentText.trim()}"`);
  }

  return column ? { kind, table, column } : { kind, table };
}

/**
 * Parse a migration file's contents into header metadata plus an ordered list
 * of guarded statements.
 *
 * @param source Raw file contents.
 * @param label Identifier used in error messages (usually the file path).
 */
export function parseMigration(source: string, label: string): ParsedMigration {
  let target: MigrationTarget | undefined;
  let description: string | undefined;

  const statements: MigrationStatement[] = [];

  // Text of the current statement, and the same text with comments removed.
  // `code` decides whether the statement is empty and drives keyword nesting.
  let raw = '';
  let code = '';
  let pendingGuards: MigrationGuard[] = [];
  let depth = 0;
  let line = 1;
  let statementStartLine = 1;
  let word = '';

  /** Apply a BEGIN/CASE/END keyword to the nesting depth. */
  const applyWord = (): void => {
    if (!word) return;
    const upper = word.toUpperCase();
    if (upper === 'BEGIN' || upper === 'CASE') {
      depth++;
    } else if (upper === 'END' && depth > 0) {
      depth--;
    }
    word = '';
  };

  const flushStatement = (): void => {
    applyWord();
    if (code.trim().length > 0) {
      statements.push({ sql: raw.trim(), guards: pendingGuards, line: statementStartLine });
      pendingGuards = [];
    }
    raw = '';
    code = '';
    depth = 0;
    statementStartLine = line;
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    // -- Line comment ------------------------------------------------------
    if (ch === '-' && next === '-') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      const commentText = source.slice(i + 2, end);

      const dbMatch = HEADER_DATABASE.exec(commentText);
      if (dbMatch) {
        target = dbMatch[1]!.toLowerCase() as MigrationTarget;
      } else {
        const descMatch = HEADER_DESCRIPTION.exec(commentText);
        if (descMatch && description === undefined) {
          description = descMatch[1];
        } else {
          const guard = parseGuard(commentText);
          if (guard) {
            if (code.trim().length > 0) {
              throw new Error(
                `${label}:${line}: @skip-if must precede a statement, not appear inside one`
              );
            }
            pendingGuards.push(guard);
          }
        }
      }

      raw += source.slice(i, end);
      i = end;
      continue;
    }

    // -- Block comment -----------------------------------------------------
    if (ch === '/' && next === '*') {
      let end = source.indexOf('*/', i + 2);
      end = end === -1 ? source.length : end + 2;
      const block = source.slice(i, end);
      raw += block;
      line += (block.match(/\n/g) || []).length;
      i = end;
      continue;
    }

    // -- String literal / quoted identifier --------------------------------
    if (ch === "'" || ch === '"' || ch === '`') {
      applyWord();
      const quote = ch;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === quote) {
          if (source[j + 1] === quote) {
            j += 2; // doubled quote = escaped quote
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      const literal = source.slice(i, j);
      raw += literal;
      code += literal;
      line += (literal.match(/\n/g) || []).length;
      i = j;
      continue;
    }

    // -- Statement terminator ----------------------------------------------
    if (ch === ';') {
      applyWord();
      if (depth === 0) {
        raw += ch;
        code += ch;
        i++;
        flushStatement();
        continue;
      }
    }

    // -- Ordinary character ------------------------------------------------
    if (isWordChar(ch)) {
      word += ch;
    } else {
      applyWord();
    }

    if (ch === '\n') {
      line++;
      if (code.trim().length === 0) statementStartLine = line;
    }

    raw += ch;
    code += ch;
    i++;
  }

  // Trailing statement without a terminating semicolon.
  flushStatement();

  if (!target) {
    throw new Error(
      `${label}: missing required header directive "-- @database: main|user|both"`
    );
  }

  return description === undefined
    ? { target, statements }
    : { target, description, statements };
}
