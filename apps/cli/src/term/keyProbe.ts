/**
 * `bible --keys` — the instrument the key-compatibility table is made with.
 *
 * Which sequence a terminal sends for `alt+1`, `shift+up` or `ctrl+pgup` cannot
 * be determined by reading documentation; several terminals intercept those
 * keys and never forward them at all. So rather than assert a table, this
 * prints what the *current* terminal actually sends and tracks which of the
 * keys the app depends on have been seen.
 *
 * Run it in each terminal, press the listed keys, and read off the summary.
 */
import { type Key, describeKey } from './keys';
import { TerminalInput } from './raw';

/** The bindings the app depends on, in the order the probe asks for them. */
const REQUIRED: ReadonlyArray<readonly [label: string, matches: (k: Key) => boolean]> = [
  ['up', (k) => k.name === 'up' && !k.shift && !k.ctrl && !k.alt],
  ['down', (k) => k.name === 'down' && !k.shift && !k.ctrl && !k.alt],
  ['left', (k) => k.name === 'left' && !k.shift && !k.ctrl && !k.alt],
  ['right', (k) => k.name === 'right' && !k.shift && !k.ctrl && !k.alt],
  ['shift+up', (k) => k.name === 'up' && k.shift],
  ['shift+down', (k) => k.name === 'down' && k.shift],
  ['pageup', (k) => k.name === 'pageup' && !k.ctrl],
  ['pagedown', (k) => k.name === 'pagedown' && !k.ctrl],
  ['ctrl+pageup', (k) => k.name === 'pageup' && k.ctrl],
  ['ctrl+pagedown', (k) => k.name === 'pagedown' && k.ctrl],
  ['f1', (k) => k.name === 'f1'],
  ['f2', (k) => k.name === 'f2'],
  ['tab', (k) => k.name === 'tab'],
  ['shift+tab', (k) => k.name === 'backtab'],
  ['enter', (k) => k.name === 'enter' && !k.alt],
  ['alt+enter', (k) => k.name === 'enter' && k.alt],
  ['escape', (k) => k.name === 'escape' && !k.alt],
  ['backspace', (k) => k.name === 'backspace'],
  ['alt+1', (k) => k.alt && k.char === '1'],
  ['alt+9', (k) => k.alt && k.char === '9'],
  ['alt+n', (k) => k.alt && k.char === 'n'],
  ['alt+w', (k) => k.alt && k.char === 'w'],
];

/** Render a raw sequence so control bytes are visible. */
export function visibleSequence(sequence: string): string {
  return [...sequence]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (ch === '\x1b') return 'ESC';
      if (ch === '\r') return 'CR';
      if (ch === '\n') return 'LF';
      if (ch === '\t') return 'TAB';
      if (ch === ' ') return 'SP';
      if (code < 0x20 || code === 0x7f) return `\\x${code.toString(16).padStart(2, '0')}`;
      return ch;
    })
    .join(' ');
}

/** The markdown row to paste into the compatibility table. */
export function summaryRow(terminal: string, seen: ReadonlySet<string>): string {
  const missing = REQUIRED.filter(([label]) => !seen.has(label)).map(([label]) => label);
  const verdict = missing.length === 0 ? 'all keys' : `missing: ${missing.join(', ')}`;
  return `| ${terminal} | ${seen.size}/${REQUIRED.length} | ${verdict} |`;
}

function terminalName(env: Readonly<Record<string, string | undefined>>): string {
  if (env.WT_SESSION) return 'Windows Terminal';
  if (env.TERM_PROGRAM) return env.TERM_PROGRAM;
  if (env.KITTY_WINDOW_ID) return 'kitty';
  if (env.TMUX) return `tmux (${env.TERM ?? '?'})`;
  return env.TERM ?? 'unknown';
}

export function runKeyProbe(): void {
  const seen = new Set<string>();
  const out = process.stdout;
  const name = terminalName(process.env);

  out.write(`bible --keys — ${name}\n`);
  out.write(`TERM=${process.env.TERM ?? '(unset)'}  size=${out.columns ?? '?'}x${out.rows ?? '?'}\n\n`);
  out.write('Press the keys below. Anything the terminal swallows will simply\n');
  out.write('never appear — that absence is the finding. Ctrl+C when done.\n\n');
  out.write(`  ${REQUIRED.map(([label]) => label).join('  ')}\n\n`);

  const input = new TerminalInput({
    onKey(key) {
      // Ctrl+C arrives as a key in raw mode, so exiting is this function's job.
      if (key.ctrl && key.char === 'c') {
        input.stop();
        out.write('\n');
        out.write(`${seen.size} of ${REQUIRED.length} required keys seen.\n\n`);
        out.write('Paste into the key-compatibility table:\n\n');
        out.write(`${summaryRow(name, seen)}\n`);
        process.exit(0);
      }

      for (const [label, matches] of REQUIRED) {
        if (matches(key)) seen.add(label);
      }

      const known = REQUIRED.some(([, matches]) => matches(key));
      const mark = known ? '*' : ' ';
      out.write(
        `${mark} ${describeKey(key).padEnd(18)} ${visibleSequence(key.sequence).padEnd(24)} ${seen.size}/${REQUIRED.length}\n`,
      );
    },
    onResize(size) {
      out.write(`  [resize ${size.columns}x${size.rows}]\n`);
    },
  });

  input.start();
}
