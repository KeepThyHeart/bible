import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandRegistry } from '../services/CommandRegistry';
import { I18nService } from '../services/I18nService';
import { whenContextService } from '../services/WhenContextService';
import { useXrefGraphStore } from '../stores/useXrefGraphStore';
import { registerXrefGraphCommands } from './xrefGraphCommands';
import type { IDisposable } from '../types/Command';
import enCommands from '../../../locales/en/commands.json';

describe('xrefGraph.open command', () => {
  let disposables: IDisposable[] = [];
  const registry = new CommandRegistry({ i18n: new I18nService(), whenContext: whenContextService });

  beforeEach(() => {
    useXrefGraphStore.setState({ isOpen: false, anchor: null });
    disposables = registerXrefGraphCommands(registry);
  });
  afterEach(() => {
    for (const d of disposables) d.dispose();
    whenContextService.set('verseSelected', false);
    whenContextService.set('selectedVerseId', null);
  });

  it('has a title and category in the English catalog', () => {
    expect(enCommands['xrefGraph.open']).toBeTruthy();
    expect(enCommands['xrefGraph.open.category']).toBeTruthy();
  });

  it('opens the graph on the selected verse', async () => {
    whenContextService.set('verseSelected', true);
    whenContextService.set('selectedVerseId', 43003016);
    await registry.execute('xrefGraph.open');
    expect(useXrefGraphStore.getState().isOpen).toBe(true);
    expect(useXrefGraphStore.getState().anchor).toBe(43003016);
  });

  it('does nothing when no verse is selected', async () => {
    whenContextService.set('selectedVerseId', null);
    try { await registry.execute('xrefGraph.open'); } catch { /* gated by when: fine */ }
    expect(useXrefGraphStore.getState().isOpen).toBe(false);
  });
});
