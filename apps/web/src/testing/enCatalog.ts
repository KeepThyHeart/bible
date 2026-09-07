/**
 * The real `locales/en` catalogs, for tests that assert on user-visible text.
 *
 * Component tests here stub `react-i18next` with a key-echoing `t()`, which is
 * right for asserting *that* a string is localized. It is not enough for
 * asserting *what* a user reads, and now that the English lives only in the
 * catalog, a test that wants to check the wording has to read it from there.
 *
 * Interpolation follows i18next's `{{name}}` syntax rather than ICU, because
 * that is what the web catalog uses. Plurals and context selectors are not
 * supported: a test needing those should assert through a real i18next
 * instance instead.
 */

import ui from '../locales/en/ui.json';
import books from '../locales/en/books.json';
import booksShort from '../locales/en/booksShort.json';
import modules from '../locales/en/modules.json';
import help from '../locales/en/help.json';

const NAMESPACES: Record<string, unknown> = { ui, books, booksShort, modules, help };

/**
 * Resolve a dotted key, with an optional `ns:` prefix. Unprefixed keys read
 * from `ui`, matching the app's `defaultNS`.
 */
function resolve(key: string): unknown {
  const [ns, rest] = key.includes(':') ? key.split(/:(.*)/s) : ['ui', key];
  const root = NAMESPACES[ns!];
  if (root === undefined) return undefined;
  return (rest ?? '')
    .split('.')
    .reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), root);
}

/** One string from the English catalog. Throws if the key is not there. */
export function enString(key: string): string {
  const value = resolve(key);
  if (typeof value !== 'string') {
    throw new Error(`No English catalog entry for "${key}" — add it to apps/web/src/locales/en/`);
  }
  return value;
}

/** Resolve a key and fill its `{{name}}` placeholders. */
export function enT(key: string, params?: Record<string, unknown>): string {
  const message = enString(key);
  if (!params) return message;
  return message.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
