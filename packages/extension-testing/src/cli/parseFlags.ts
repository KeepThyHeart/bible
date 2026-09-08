/**
 * Minimal flag parser for the `@bible/extension-testing` CLI. Avoids pulling
 * in yargs/commander/etc. — we only need `--key=value`, `--key value`,
 * boolean `--flag`, short `-h`, and a single positional argument.
 */

export interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export class FlagParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlagParseError';
  }
}

export interface FlagSpec {
  /** Names that take a string value (either `--k=v` or `--k v`). */
  stringFlags: readonly string[];
  /** Names that are booleans (`--k` with no value). */
  booleanFlags: readonly string[];
  /** Short aliases → canonical long name. */
  aliases?: Readonly<Record<string, string>>;
}

export function parseFlags(argv: readonly string[], spec: FlagSpec): ParsedFlags {
  const stringSet = new Set(spec.stringFlags);
  const boolSet = new Set(spec.booleanFlags);
  const aliases = spec.aliases ?? {};
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') {
      for (let j = i + 1; j < argv.length; j++) positional.push(argv[j] as string);
      break;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      const name = eq >= 0 ? body.slice(0, eq) : body;
      const inline = eq >= 0 ? body.slice(eq + 1) : undefined;
      if (stringSet.has(name)) {
        if (inline !== undefined) {
          flags[name] = inline;
        } else {
          const next = argv[i + 1];
          if (next === undefined || next.startsWith('-')) {
            throw new FlagParseError(`Flag --${name} requires a value`);
          }
          flags[name] = next;
          i++;
        }
      } else if (boolSet.has(name)) {
        if (inline !== undefined) {
          throw new FlagParseError(`Flag --${name} does not take a value`);
        }
        flags[name] = true;
      } else {
        throw new FlagParseError(`Unknown flag --${name}`);
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const short = arg.slice(1);
      const canonical = aliases[short];
      if (canonical === undefined) {
        throw new FlagParseError(`Unknown flag -${short}`);
      }
      if (boolSet.has(canonical)) {
        flags[canonical] = true;
      } else if (stringSet.has(canonical)) {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('-')) {
          throw new FlagParseError(`Flag -${short} requires a value`);
        }
        flags[canonical] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}
