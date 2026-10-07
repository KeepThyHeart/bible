import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nService } from './I18nService';
import { LocaleCatalogLoader, type LocaleCatalogBridge } from './LocaleCatalogLoader';

/** A fake bridge over an in-memory `locales/` tree (built-in) plus an optional user tree. */
function fakeBridge(builtin: Record<string, Record<string, string>>, user: Record<string, Record<string, string>> = {}): LocaleCatalogBridge {
  const list = (tree: typeof builtin) => async () =>
    Object.keys(tree).map((k) => {
      const [locale, namespace] = k.split('/');
      return { locale, namespace };
    });
  const read = (tree: typeof builtin) => async (locale: string, ns: string) => {
    const f = tree[`${locale}/${ns}`];
    if (!f) throw new Error('ENOENT');
    return f;
  };
  return {
    listBuiltinCatalogs: list(builtin),
    readBuiltinCatalog: read(builtin),
    listUserCatalogs: list(user),
    readUserCatalog: read(user),
  };
}

function install(bridge: LocaleCatalogBridge): void {
  (globalThis as unknown as { window: unknown }).window = { electron: { i18n: bridge } };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('LocaleCatalogLoader namespaces (task 0113)', () => {
  const tree = {
    'en/ui': { 'ui.hello': 'Hello' },
    'en/quiz': { 'quiz.title': 'Quiz' },
    'es/quiz': { 'quiz.title': 'Cuestionario' },
  };

  it('loadAll skips a registered lazy namespace; loadNamespace reads it', async () => {
    install(fakeBridge(tree));
    const i18n = new I18nService();
    const loader = new LocaleCatalogLoader(i18n);
    loader.registerLazyNamespace('quiz');
    await loader.loadAll();
    expect(i18n.t('ui.hello')).toBe('Hello');
    // not loaded eagerly: the first t() of the namespace starts the lazy load
    const changed = vi.fn();
    i18n.onDidChangeLocale(changed);
    expect(i18n.t('quiz.title')).toBe('[quiz.title]');
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(i18n.t('quiz.title')).toBe('Quiz');
  });

  it('merges a user catalog over the built-in one', async () => {
    install(fakeBridge(tree, { 'en/quiz': { 'quiz.title': 'My Quiz' } }));
    const i18n = new I18nService();
    const loader = new LocaleCatalogLoader(i18n);
    await loader.loadNamespace('quiz');
    expect(i18n.t('quiz.title')).toBe('My Quiz');
  });

  it('is a no-op for a namespace with no files and without a bridge', async () => {
    install(fakeBridge(tree));
    const loader = new LocaleCatalogLoader(new I18nService());
    await expect(loader.loadNamespace('missing')).resolves.toBeUndefined();
    delete (globalThis as unknown as { window?: unknown }).window;
    await expect(new LocaleCatalogLoader(new I18nService()).loadNamespace('quiz')).resolves.toBeUndefined();
  });
});
