/**
 * Message lookup shared by the core and the UI (task 0114 M3).
 *
 * Every user-visible string in the package is written `tr(key, 'English', params?)`: the key is
 * the entry in the host's catalog (`apps/desktop/locales/<locale>/memory.json`), the English is the
 * built-in fallback used when no catalog is wired (tests, a host without translations) or the key
 * is missing. `memory-catalog.test.ts` holds the two English copies equal, so the fallback cannot
 * drift from `locales/en/memory.json`.
 *
 * A host passes its own translator (`MemoryUiOptions.t`, `MemoryHost.t`); this module's `format`
 * understands the ICU subset the catalogs use: `{name}` and `{n, plural, one {..} other {..}}`
 * with `#` for the number. Core messages (main process) use plain `{name}` only.
 */

export type MessageParams = Readonly<Record<string, string | number>>;

/** `(key, englishFallback, params?) => text`. Pure and synchronous. */
export type Translate = (key: string, fallback: string, params?: MessageParams) => string;

/** Find the end of the `{...}` group that starts at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return text.length;
}

/** Format an ICU-subset message. `locale` picks plural categories (default English). */
export function formatMessage(message: string, params: MessageParams = {}, locale = 'en'): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const ch = message[i]!;
    if (ch !== '{') {
      out += ch;
      i++;
      continue;
    }
    const end = closing(message, i);
    const body = message.slice(i + 1, end);
    const comma = body.indexOf(',');
    if (comma < 0) {
      const name = body.trim();
      out += name in params ? String(params[name]) : `{${name}}`;
    } else {
      const name = body.slice(0, comma).trim();
      const rest = body.slice(comma + 1);
      const kind = rest.slice(0, rest.indexOf(',')).trim();
      const options = rest.slice(rest.indexOf(',') + 1);
      const value = Number(params[name] ?? 0);
      if (kind === 'plural') {
        const cases = new Map<string, string>();
        for (let j = 0; j < options.length; ) {
          while (j < options.length && /\s/.test(options[j]!)) j++;
          const brace = options.indexOf('{', j);
          if (brace < 0) break;
          const label = options.slice(j, brace).trim();
          const stop = closing(options, brace);
          cases.set(label, options.slice(brace + 1, stop));
          j = stop + 1;
        }
        let category = 'other';
        try {
          category = new Intl.PluralRules(locale).select(value);
        } catch {
          category = value === 1 ? 'one' : 'other';
        }
        const chosen = cases.get(`=${value}`) ?? cases.get(category) ?? cases.get('other') ?? '';
        out += formatMessage(chosen.replace(/#/g, String(value)), params, locale);
      } else {
        out += name in params ? String(params[name]) : '';
      }
    }
    i = end + 1;
  }
  return out;
}

/** The translator used when a host wires none: the English fallback, formatted. */
export const englishTranslate: Translate = (_key, fallback, params) => (params ? formatMessage(fallback, params) : fallback);

let coreTranslate: Translate = englishTranslate;

/** Install the translator for messages the core shows the user (errors, notices). Without one: English. */
export function setCoreTranslator(t?: Translate): void {
  coreTranslate = t ?? englishTranslate;
}

/** Translate a core message for the user. Plain `{name}` placeholders only (main-process catalogs have no plurals). */
export function tc(key: string, fallback: string, params?: MessageParams): string {
  return coreTranslate(key, fallback, params);
}
