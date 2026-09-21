import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRegistry } from './CommandRegistry';
import { DuplicateCommandError } from './ICommandRegistry';
import { WhenContextService } from './WhenContextService';
import { I18nService } from './I18nService';
import { CommandNotFoundError, ExtensionCommandPrefixError } from '../types/Command';

function makeRegistry() {
  const i18n = new I18nService();
  i18n.loadCatalog('en', 'commands', {
    'test.foo': 'Foo Command',
    'test.foo.category': 'Test',
    'test.foo.alias.0': 'qux',
    'test.bar': 'Bar Command',
    'test.bar.category': 'Test',
    'test.gated': 'Gated',
    'test.gated.category': 'Test',
  });
  const whenContext = new WhenContextService();
  const registry = new CommandRegistry({ i18n, whenContext });
  return { registry, whenContext, i18n };
}

describe('CommandRegistry', () => {
  let h: ReturnType<typeof makeRegistry>;
  beforeEach(() => {
    h = makeRegistry();
  });

  it('register + get', () => {
    const handler = vi.fn();
    h.registry.register({ id: 'test.foo', title: { key: 'test.foo' }, handler });
    expect(h.registry.get('test.foo')?.id).toBe('test.foo');
  });

  it('rejects duplicate IDs (first-wins)', () => {
    h.registry.register({ id: 'test.foo', title: 'A', handler: vi.fn() });
    expect(() =>
      h.registry.register({ id: 'test.foo', title: 'B', handler: vi.fn() }),
    ).toThrow(DuplicateCommandError);
    expect(h.registry.get('test.foo')?.title).toBe('A');
  });

  it('dispose removes the registration', () => {
    const sub = h.registry.register({ id: 'test.foo', title: 'A', handler: vi.fn() });
    sub.dispose();
    expect(h.registry.get('test.foo')).toBeUndefined();
  });

  it('execute() calls handler with snapshot context', async () => {
    const handler = vi.fn();
    h.registry.register({ id: 'test.foo', title: { key: 'test.foo' }, handler });
    h.whenContext.set('verseSelected', true);
    await h.registry.execute('test.foo');
    expect(handler).toHaveBeenCalledOnce();
    const ctx = handler.mock.calls[0]![0];
    expect(ctx.commandId).toBe('test.foo');
    expect(ctx.invocationContext.get('verseSelected')).toBe(true);
  });

  it('execute() throws CommandNotFoundError for unknown id', async () => {
    await expect(h.registry.execute('does.not.exist')).rejects.toThrow(CommandNotFoundError);
  });

  it('execute() silently no-ops if when clause is unsatisfied', async () => {
    const handler = vi.fn();
    h.registry.register({
      id: 'test.gated',
      title: { key: 'test.gated' },
      when: 'verseSelected',
      handler,
    });
    // No verseSelected in context.
    await h.registry.execute('test.gated');
    expect(handler).not.toHaveBeenCalled();
  });

  it('query() filters by when clause', () => {
    h.registry.register({
      id: 'test.foo',
      title: { key: 'test.foo' },
      handler: vi.fn(),
    });
    h.registry.register({
      id: 'test.gated',
      title: { key: 'test.gated' },
      when: 'verseSelected',
      handler: vi.fn(),
    });
    let snap = h.whenContext.snapshot();
    let results = h.registry.query('', snap);
    expect(results.map((r) => r.id)).toEqual(['test.foo']);

    h.whenContext.set('verseSelected', true);
    snap = h.whenContext.snapshot();
    results = h.registry.query('', snap);
    expect(results.map((r) => r.id).sort()).toEqual(['test.foo', 'test.gated']);
  });

  it('query() returns localized titles', () => {
    h.registry.register({ id: 'test.foo', title: { key: 'test.foo' }, category: { key: 'test.foo.category' }, handler: vi.fn() });
    const results = h.registry.query('foo', h.whenContext.snapshot());
    expect(results[0]!.title).toBe('Foo Command');
    expect(results[0]!.category).toBe('Test');
  });

  it('query() finds via catalog aliases', () => {
    h.registry.register({ id: 'test.foo', title: { key: 'test.foo' }, handler: vi.fn() });
    const results = h.registry.query('qux', h.whenContext.snapshot());
    expect(results.map((r) => r.id)).toContain('test.foo');
  });

  it('query() empty prefix returns all visible commands', () => {
    h.registry.register({ id: 'test.foo', title: { key: 'test.foo' }, handler: vi.fn() });
    h.registry.register({ id: 'test.bar', title: { key: 'test.bar' }, handler: vi.fn() });
    const results = h.registry.query('', h.whenContext.snapshot());
    expect(results.length).toBe(2);
  });

  it('hidden commands are not returned by query but are executable', async () => {
    const handler = vi.fn();
    h.registry.register({ id: 'test.foo', title: { key: 'test.foo' }, hidden: true, handler });
    const results = h.registry.query('', h.whenContext.snapshot());
    expect(results.find((r) => r.id === 'test.foo')).toBeUndefined();
    await h.registry.execute('test.foo');
    expect(handler).toHaveBeenCalled();
  });

  it('onDidChange fires on register and dispose', () => {
    const listener = vi.fn();
    h.registry.onDidChange(listener);
    const sub = h.registry.register({ id: 'test.foo', title: 'A', handler: vi.fn() });
    sub.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  // --- extension ownership -------------------------------------------------

  describe('extension ownership', () => {
    it('accepts an extension command with the correct prefix', () => {
      h.registry.register({
        id: 'ext.demo.greet',
        title: 'Greet',
        ownerExtensionId: 'demo',
        handler: vi.fn(),
      });
      expect(h.registry.get('ext.demo.greet')?.ownerExtensionId).toBe('demo');
    });

    it('accepts a fully qualified manifest id as the owner', () => {
      // The regression this guards: a real extension's `ownerExtensionId` is
      // its manifest id, which `ID_PATTERN` requires to start with `ext.`.
      // Concatenating `ext.` again made the expected prefix
      // `ext.ext.acme.plan.`, so this - the correct id an author would write -
      // threw `ExtensionCommandPrefixError`, and no extension could register a
      // command at all.
      h.registry.register({
        id: 'ext.acme.plan.start',
        title: 'Start',
        ownerExtensionId: 'ext.acme.plan',
        handler: vi.fn(),
      });
      expect(h.registry.get('ext.acme.plan.start')?.ownerExtensionId).toBe('ext.acme.plan');
    });

    it('still rejects a command that borrows another extension id', () => {
      // Normalising the owner must not weaken the rule into "starts with
      // ext.". `ext.acme.plan` may not claim ids under `ext.other`.
      expect(() =>
        h.registry.register({
          id: 'ext.other.start',
          title: 'Start',
          ownerExtensionId: 'ext.acme.plan',
          handler: vi.fn(),
        }),
      ).toThrow(ExtensionCommandPrefixError);
    });

    it('rejects an extension command id without the ext.<id>. prefix', () => {
      expect(() =>
        h.registry.register({
          id: 'demo.greet',
          title: 'Greet',
          ownerExtensionId: 'demo',
          handler: vi.fn(),
        }),
      ).toThrow(ExtensionCommandPrefixError);
    });

    it('rejects an extension command id from the wrong owner', () => {
      expect(() =>
        h.registry.register({
          id: 'ext.other.greet',
          title: 'Greet',
          ownerExtensionId: 'demo',
          handler: vi.fn(),
        }),
      ).toThrow(ExtensionCommandPrefixError);
    });

    it('disposeByOwner removes only that extension\'s commands', () => {
      h.registry.register({ id: 'test.builtin', title: 'A', handler: vi.fn() });
      h.registry.register({
        id: 'ext.demo.one',
        title: 'B',
        ownerExtensionId: 'demo',
        handler: vi.fn(),
      });
      h.registry.register({
        id: 'ext.demo.two',
        title: 'C',
        ownerExtensionId: 'demo',
        handler: vi.fn(),
      });
      h.registry.register({
        id: 'ext.other.one',
        title: 'D',
        ownerExtensionId: 'other',
        handler: vi.fn(),
      });

      const removed = h.registry.disposeByOwner('demo');
      expect(removed).toBe(2);
      expect(h.registry.get('ext.demo.one')).toBeUndefined();
      expect(h.registry.get('ext.demo.two')).toBeUndefined();
      expect(h.registry.get('test.builtin')).toBeDefined();
      expect(h.registry.get('ext.other.one')).toBeDefined();
    });

    it('disposeByOwner returns 0 and does not fire onDidChange for unknown owner', () => {
      h.registry.register({ id: 'test.builtin', title: 'A', handler: vi.fn() });
      const listener = vi.fn();
      h.registry.onDidChange(listener);
      expect(h.registry.disposeByOwner('nobody')).toBe(0);
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
