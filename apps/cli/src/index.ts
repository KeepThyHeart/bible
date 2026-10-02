/**
 * `bible` — entry point.
 *
 * Argument handling and the terminal check only. Everything between the process
 * beginning and the first frame lives in `app/startup.ts`, so that it can be
 * exercised without a terminal.
 */
import { startup } from './app/startup';
import { runKeyProbe } from './term/keyProbe';
import { PRODUCT, VERSION } from './version';

const USAGE = `${PRODUCT} ${VERSION} — a terminal Bible reader

usage:
  ${PRODUCT}                 open the reader at the last passage
  ${PRODUCT} <reference>     open at a reference, e.g. "jo 3:16", "i cor 9"
  ${PRODUCT} <words>         search for anything that is not a reference
  ${PRODUCT} --keys          report what this terminal sends for each key
  ${PRODUCT} --version       print the version and exit
  ${PRODUCT} --help          print this message and exit
`;

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (argv.includes('--keys')) {
    // Takes over stdin and exits from inside its own ctrl+c handler.
    runKeyProbe();
    return -1;
  }

  // A full-screen application on a pipe writes escape sequences into whatever is
  // reading it and has no way to receive keys. Refuse rather than hang.
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write(`${PRODUCT}: not a terminal — nothing to read from or draw to.\n`);
    return 1;
  }

  // Everything that is not a flag is the reference to open at, joined so the
  // shell can hand it over either quoted or split — `bible "i cor 9"` and
  // `bible i cor 9` mean the same thing, and requiring the quotes would be a
  // trap. Anything that does not parse as a reference is searched for, which is
  // exactly what the input line does with the same text.
  const openAt = argv.filter((arg) => !arg.startsWith('-')).join(' ').trim();

  const { app } = await startup(openAt === '' ? {} : { openAt });
  await app.run();
  return -1;
}

// A negative code means the command took over the process and will exit on its
// own — exiting here would kill it before the user pressed anything.
const code = await main(process.argv.slice(2));
if (code >= 0) process.exit(code);
