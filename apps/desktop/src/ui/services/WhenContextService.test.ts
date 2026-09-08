import { describe, it, expect, vi } from 'vitest';
import { WhenContextService } from './WhenContextService';
import { WhenContextNamespaceError } from './IWhenContextService';

describe('WhenContextService', () => {
  it('set/get round-trips', () => {
    const svc = new WhenContextService();
    svc.set('verseSelected', true);
    expect(svc.get('verseSelected')).toBe(true);
  });

  it('snapshot is frozen and decoupled from later mutations', () => {
    const svc = new WhenContextService();
    svc.set('a', 1);
    const snap = svc.snapshot();
    svc.set('a', 2);
    expect(snap.get('a')).toBe(1);
    expect(svc.get('a')).toBe(2);
  });

  it('snapshot.has and toJSON', () => {
    const svc = new WhenContextService();
    svc.set('x', 'v');
    const snap = svc.snapshot();
    expect(snap.has('x')).toBe(true);
    expect(snap.has('y')).toBe(false);
    expect(snap.toJSON()).toEqual({ x: 'v' });
  });

  it('change events fire only on actual changes (coalesced per microtask)', async () => {
    const svc = new WhenContextService();
    const listener = vi.fn();
    svc.onDidChange(listener);
    svc.set('a', 1);
    svc.set('b', 2);
    svc.set('a', 1); // no-op
    await Promise.resolve(); // drain microtask
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as { keys: string[] };
    expect(event.keys.sort()).toEqual(['a', 'b']);
  });

  it('does not fire when value is unchanged', async () => {
    const svc = new WhenContextService();
    svc.set('a', 1);
    await Promise.resolve();
    const listener = vi.fn();
    svc.onDidChange(listener);
    svc.set('a', 1);
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });

  it('evaluate uses live values', () => {
    const svc = new WhenContextService();
    svc.set('verseSelected', true);
    expect(svc.evaluate('verseSelected')).toBe(true);
    svc.set('verseSelected', false);
    expect(svc.evaluate('verseSelected')).toBe(false);
  });

  it('evaluateAgainst uses snapshot, not live values', () => {
    const svc = new WhenContextService();
    svc.set('verseSelected', true);
    const snap = svc.snapshot();
    svc.set('verseSelected', false);
    expect(svc.evaluateAgainst('verseSelected', snap)).toBe(true);
    expect(svc.evaluate('verseSelected')).toBe(false);
  });

  it('disposing a listener stops further events', async () => {
    const svc = new WhenContextService();
    const listener = vi.fn();
    const sub = svc.onDidChange(listener);
    svc.set('a', 1);
    await Promise.resolve();
    sub.dispose();
    svc.set('a', 2);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // --- extension namespace guard -------------------------------------------

  describe('setForExtension namespace guard', () => {
    it('accepts a key in the extension\'s own ext.<id>.* namespace', () => {
      const svc = new WhenContextService();
      svc.setForExtension('demo', 'ext.demo.ready', true);
      expect(svc.get('ext.demo.ready')).toBe(true);
    });

    it('rejects a built-in key', () => {
      const svc = new WhenContextService();
      expect(() => svc.setForExtension('demo', 'editorFocused', true)).toThrow(
        WhenContextNamespaceError,
      );
      expect(svc.get('editorFocused')).toBeUndefined();
    });

    it('rejects another extension\'s key', () => {
      const svc = new WhenContextService();
      expect(() => svc.setForExtension('demo', 'ext.other.flag', true)).toThrow(
        WhenContextNamespaceError,
      );
    });

    it('disposeExtensionKeys removes only that extension\'s keys', async () => {
      const svc = new WhenContextService();
      svc.set('verseSelected', true); // built-in
      svc.setForExtension('demo', 'ext.demo.a', 1);
      svc.setForExtension('demo', 'ext.demo.b', 2);
      svc.setForExtension('other', 'ext.other.x', true);

      const removed = svc.disposeExtensionKeys('demo');
      expect(removed).toBe(2);
      expect(svc.get('ext.demo.a')).toBeUndefined();
      expect(svc.get('ext.demo.b')).toBeUndefined();
      expect(svc.get('verseSelected')).toBe(true);
      expect(svc.get('ext.other.x')).toBe(true);
    });

    it('disposeExtensionKeys fires onDidChange for the dropped keys', async () => {
      const svc = new WhenContextService();
      svc.setForExtension('demo', 'ext.demo.a', 1);
      await Promise.resolve();
      const listener = vi.fn();
      svc.onDidChange(listener);
      svc.disposeExtensionKeys('demo');
      await Promise.resolve();
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0]![0] as { keys: string[] };
      expect(event.keys).toEqual(['ext.demo.a']);
    });

    it('error code matches the extension api PermissionDeniedError', () => {
      const svc = new WhenContextService();
      try {
        svc.setForExtension('demo', 'editorFocused', true);
      } catch (err) {
        expect(err).toBeInstanceOf(WhenContextNamespaceError);
        expect((err as WhenContextNamespaceError).code).toBe('PermissionDeniedError');
        return;
      }
      throw new Error('expected throw');
    });
  });
});
