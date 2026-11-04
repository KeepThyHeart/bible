import { describe, it, expect } from 'vitest';
import { I18nService } from './I18nService';
import { loadBundledEnglishCatalogs } from './bundledCatalogs';

// B-196: a popped-out pane is its own renderer. loadCatalog() fires no event, so a pane that
// rendered before the async catalog load finished kept showing `[key]` for English forever.
// The detached entry therefore seeds the bundled English catalogs synchronously, like main.tsx.
describe('loadBundledEnglishCatalogs', () => {
  it('resolves the notes pane and editor toolbar keys on a fresh service, with no async load', () => {
    const i18n = new I18nService();
    loadBundledEnglishCatalogs(i18n);
    expect(i18n.t('userNotesPane.savedStatus')).toBe('Saved');
    expect(i18n.t('userNotesPane.breadcrumbHome')).toBe('Home');
    expect(i18n.t('editorToolbar.noteDirectionLabel')).toBe('Note direction');
    expect(i18n.t('notesSetupDialog.title')).not.toMatch(/^\[/);
  });
});
