import { describe, it, expect, vi } from 'vitest';
import { I18nService } from './I18nService';

describe('I18nService', () => {
  it('resolves a key from the en catalog', () => {
    const svc = new I18nService();
    svc.loadCatalog('en', 'commands', { 'foo.bar': 'Foo Bar' });
    expect(svc.t('foo.bar')).toBe('Foo Bar');
  });

  it('falls back to en when current locale lacks the key', () => {
    const svc = new I18nService({ initialLocale: 'es' });
    svc.loadCatalog('en', 'commands', { 'foo.bar': 'Foo Bar' });
    svc.loadCatalog('es', 'commands', { 'other.key': 'Otro' });
    expect(svc.t('foo.bar')).toBe('Foo Bar');
  });

  it('returns key in brackets when missing everywhere', () => {
    const svc = new I18nService();
    expect(svc.t('does.not.exist')).toBe('[does.not.exist]');
  });

  it('uses the locale-specific value when present', () => {
    const svc = new I18nService({ initialLocale: 'es' });
    svc.loadCatalog('en', 'commands', { 'greeting': 'Hello' });
    svc.loadCatalog('es', 'commands', { 'greeting': 'Hola' });
    expect(svc.t('greeting')).toBe('Hola');
  });

  it('resolve() passes through literal strings unchanged', () => {
    const svc = new I18nService();
    expect(svc.resolve('Already Localized')).toBe('Already Localized');
  });

  it('resolve() looks up { key } objects', () => {
    const svc = new I18nService();
    svc.loadCatalog('en', 'commands', { 'foo.bar': 'Foo Bar' });
    expect(svc.resolve({ key: 'foo.bar' })).toBe('Foo Bar');
  });

  it('tAliases() collects sequential .alias.N entries', () => {
    const svc = new I18nService();
    svc.loadCatalog('en', 'commands', {
      'foo': 'Foo',
      'foo.alias.0': 'fu',
      'foo.alias.1': 'phoo',
      'foo.alias.2': 'fooey',
    });
    expect(svc.tAliases('foo')).toEqual(['fu', 'phoo', 'fooey']);
  });

  it('tAliases() returns empty when no aliases registered', () => {
    const svc = new I18nService();
    svc.loadCatalog('en', 'commands', { 'foo': 'Foo' });
    expect(svc.tAliases('foo')).toEqual([]);
  });

  it('setLocale() fires onDidChangeLocale and updates currentLocale', async () => {
    const svc = new I18nService();
    svc.loadCatalog('es', 'commands', {});
    const listener = vi.fn();
    svc.onDidChangeLocale(listener);
    await svc.setLocale('es');
    expect(svc.currentLocale).toBe('es');
    expect(listener).toHaveBeenCalledWith('es');
  });

  it('setLocale() to current locale is a no-op', async () => {
    const svc = new I18nService();
    const listener = vi.fn();
    svc.onDidChangeLocale(listener);
    await svc.setLocale('en');
    expect(listener).not.toHaveBeenCalled();
  });

  it('setLocale() invokes the persist callback', async () => {
    const persist = vi.fn();
    const svc = new I18nService({ persistLocale: persist });
    svc.loadCatalog('es', 'commands', {});
    await svc.setLocale('es');
    expect(persist).toHaveBeenCalledWith('es');
  });

  it('availableLocales reflects loaded catalogs', () => {
    const svc = new I18nService();
    svc.loadCatalog('es', 'commands', {});
    svc.loadCatalog('fr', 'commands', {});
    expect(svc.availableLocales.sort()).toEqual(['en', 'es', 'fr']);
  });

  it('naive {name} substitution works synchronously without ICU loaded', () => {
    const svc = new I18nService();
    svc.loadCatalog('en', 'commands', { 'hello': 'Hello, {name}!' });
    // First call uses naive fallback because ICU is async-loaded.
    expect(svc.t('hello', { name: 'World' })).toBe('Hello, World!');
  });

  it('messages without ICU placeholders skip the formatter entirely', () => {
    const svc = new I18nService();
    svc.loadCatalog('en', 'commands', { 'plain': 'A plain message.' });
    expect(svc.t('plain', { ignored: 1 })).toBe('A plain message.');
  });

  describe('locale metadata', () => {
    const META_EN = {
      'locale.name': 'English',
      'locale.nativeName': 'English',
      'locale.status': 'complete',
      'locale.direction': 'ltr',
    };
    const META_ES = {
      'locale.name': 'Spanish',
      'locale.nativeName': 'Español',
      'locale.status': 'draft',
      'locale.direction': 'ltr',
    };

    it('reads metadata from the locale meta catalog', () => {
      const svc = new I18nService();
      svc.loadCatalog('es', 'meta', META_ES);
      expect(svc.getLocaleMetadata('es')).toEqual({
        code: 'es',
        name: 'Spanish',
        nativeName: 'Español',
        status: 'draft',
        direction: 'ltr',
      });
    });

    it('never resolves metadata through the en fallback', () => {
      // Without this, every locale would report itself as English/complete.
      const svc = new I18nService();
      svc.loadCatalog('en', 'meta', META_EN);
      svc.loadCatalog('fr', 'ui', { greeting: 'Bonjour' });
      const fr = svc.getLocaleMetadata('fr');
      expect(fr.name).toBe('fr');
      expect(fr.status).toBe('draft');
    });

    it('treats a locale with no metadata as a draft, not as complete', () => {
      const svc = new I18nService();
      svc.loadCatalog('de', 'ui', {});
      expect(svc.getLocaleMetadata('de').status).toBe('draft');
    });

    it('rejects an unrecognized status or direction value', () => {
      const svc = new I18nService();
      svc.loadCatalog('qq', 'meta', {
        'locale.name': 'Bogus',
        'locale.nativeName': 'Bogus',
        'locale.status': 'totally-fine-honest',
        'locale.direction': 'sideways',
      });
      const meta = svc.getLocaleMetadata('qq');
      expect(meta.status).toBe('draft');
      expect(meta.direction).toBe('ltr');
    });

    it('falls back to the English name when nativeName is absent', () => {
      const svc = new I18nService();
      svc.loadCatalog('hi', 'meta', { 'locale.name': 'Hindi' });
      expect(svc.getLocaleMetadata('hi').nativeName).toBe('Hindi');
    });

    it('exposes rtl direction so an Arabic locale can be added later', () => {
      const svc = new I18nService();
      svc.loadCatalog('ar', 'meta', {
        'locale.name': 'Arabic',
        'locale.nativeName': 'العربية',
        'locale.status': 'draft',
        'locale.direction': 'rtl',
      });
      expect(svc.getLocaleMetadata('ar').direction).toBe('rtl');
    });

    it('currentDirection reflects the active locale', async () => {
      const svc = new I18nService();
      svc.loadCatalog('en', 'meta', META_EN);
      svc.loadCatalog('ar', 'meta', { 'locale.direction': 'rtl' });
      expect(svc.currentDirection).toBe('ltr');
      await svc.setLocale('ar');
      expect(svc.currentDirection).toBe('rtl');
    });

    it('availableLocaleInfos lists en first, then complete, then drafts', () => {
      const svc = new I18nService();
      svc.loadCatalog('en', 'meta', META_EN);
      svc.loadCatalog('es', 'meta', META_ES);
      svc.loadCatalog('fr', 'meta', {
        'locale.name': 'French',
        'locale.nativeName': 'Français',
        'locale.status': 'complete',
        'locale.direction': 'ltr',
      });
      expect(svc.availableLocaleInfos.map((l) => l.code)).toEqual(['en', 'fr', 'es']);
    });

    it('availableLocaleInfos surfaces draft status for the language picker', () => {
      const svc = new I18nService();
      svc.loadCatalog('en', 'meta', META_EN);
      svc.loadCatalog('es', 'meta', META_ES);
      const es = svc.availableLocaleInfos.find((l) => l.code === 'es');
      expect(es?.status).toBe('draft');
      expect(es?.nativeName).toBe('Español');
    });
  });

  describe('nested catalog references as ICU parameters', () => {
    /**
     * These guard a crash that took the whole renderer down.
     *
     * `layoutCommands.ts` registers a title of `layout.applyPreset.title`
     * ("Apply {presetName}") whose `presetName` is itself a catalog reference,
     * `{ key: 'layout.studyMode.name' }`. Nothing resolved that inner object, and
     * `intl-messageformat` returns an **array** rather than a string whenever an
     * argument is not a primitive. The array escaped `formatWithIcu` - declared
     * `: string`, and the local formatter type wrongly claimed `string` too, so
     * the compiler never objected - and reached `CommandRegistry.query`, which
     * called `.toLowerCase()` on it and killed the renderer.
     *
     * It only reproduced on the *second* query: ICU is imported lazily, and until
     * it resolves `formatWithIcu` falls back to `naiveFormat`, which stringifies.
     * That is why every existing test here passed. `waitForIcu` forces the real
     * formatter to be in play, which is the whole point of these cases.
     */
    const CATALOG = {
      'layout.applyPreset.title': 'Apply {presetName}',
      'layout.studyMode.name': 'Study Mode',
    };

    /**
     * Poll until the lazily-imported ICU formatter is in play. Before it
     * resolves, `formatWithIcu` falls back to `naiveFormat`, which stringifies
     * everything and would mask exactly the bug under test.
     */
    async function waitForIcu(assert: () => void): Promise<void> {
      await vi.waitFor(assert, { timeout: 2000 });
    }

    it('resolves a nested key parameter instead of leaking the object', async () => {
      const svc = new I18nService();
      svc.loadCatalog('en', 'layout', CATALOG);

      await waitForIcu(() => {
        expect(
          svc.t('layout.applyPreset.title', { presetName: { key: 'layout.studyMode.name' } }),
        ).toBe('Apply Study Mode');
      });
    });

    it('always returns a real string, so string methods cannot throw', async () => {
      const svc = new I18nService();
      svc.loadCatalog('en', 'layout', CATALOG);

      await waitForIcu(() => {
        const title = svc.t('layout.applyPreset.title', {
          presetName: { key: 'layout.studyMode.name' },
        });
        expect(typeof title).toBe('string');
        // The exact call CommandRegistry.query makes.
        expect(() => title.toLowerCase()).not.toThrow();
        expect(title.toLowerCase()).toContain('study mode');
      });
    });

    it('translates the nested reference with the outer message', async () => {
      const svc = new I18nService({ initialLocale: 'es' });
      svc.loadCatalog('en', 'layout', CATALOG);
      svc.loadCatalog('es', 'layout', {
        'layout.applyPreset.title': 'Aplicar {presetName}',
        'layout.studyMode.name': 'Modo de estudio',
      });

      await waitForIcu(() => {
        expect(
          svc.t('layout.applyPreset.title', { presetName: { key: 'layout.studyMode.name' } }),
        ).toBe('Aplicar Modo de estudio');
      });
    });

    it('leaves plain primitive parameters untouched', async () => {
      const svc = new I18nService();
      svc.loadCatalog('en', 'layout', { 'greet': 'Hello {name}, you have {n} messages' });

      await waitForIcu(() => {
        expect(svc.t('greet', { name: 'Ada', n: 3 })).toBe('Hello Ada, you have 3 messages');
      });
    });

    it('degrades to a string even for an unresolvable object parameter', async () => {
      const svc = new I18nService();
      svc.loadCatalog('en', 'layout', { 'x': 'Value: {v}' });

      await waitForIcu(() => {
        // Not a catalog reference, so resolveParams cannot help - the coercion
        // in formatWithIcu is what keeps this from returning an array.
        const out = svc.t('x', { v: { not: 'a key' } });
        expect(typeof out).toBe('string');
        expect(() => out.toLowerCase()).not.toThrow();
      });
    });
  });
});
