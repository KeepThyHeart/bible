import { describe, it, expect } from 'vitest';
import {
  resolveKeybinding,
  whenSpecificity,
  normalizeBindingToken,
  eventToToken,
} from './KeybindingResolver';
import { WhenContextService } from './WhenContextService';
import type { KeybindingRegistration } from './IKeybindingService';

function fakeKeyEvent(opts: {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}): KeyboardEvent {
  // KeyboardEvent constructor exists in jsdom; build a minimal object that
  // resolveKeybinding's eventToToken understands.
  return {
    key: opts.key,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    altKey: !!opts.alt,
    metaKey: !!opts.meta,
  } as KeyboardEvent;
}

function withOrder(
  bindings: KeybindingRegistration[],
): Array<KeybindingRegistration & { _registrationOrder: number }> {
  return bindings.map((b, i) => ({ ...b, _registrationOrder: i }));
}

describe('eventToToken', () => {
  it('Ctrl+Shift+P', () => {
    const ev = fakeKeyEvent({ key: 'p', ctrl: true, shift: true });
    expect(eventToToken(ev, false)).toBe('Ctrl+Shift+P');
  });
  it('uppercase letters normalized', () => {
    const ev = fakeKeyEvent({ key: 'A' });
    expect(eventToToken(ev, false)).toBe('A');
  });
  it('special keys preserved', () => {
    const ev = fakeKeyEvent({ key: 'Enter' });
    expect(eventToToken(ev, false)).toBe('Enter');
  });
  it('mac uses Cmd for meta', () => {
    const ev = fakeKeyEvent({ key: 'p', meta: true });
    expect(eventToToken(ev, true)).toBe('Cmd+P');
  });
});

describe('normalizeBindingToken', () => {
  it('canonicalizes synonyms', () => {
    expect(normalizeBindingToken('control+shift+p')).toBe('Ctrl+Shift+P');
    expect(normalizeBindingToken('command+a')).toBe('Cmd+A');
    expect(normalizeBindingToken('option+b')).toBe('Alt+B');
  });
});

describe('whenSpecificity', () => {
  it('empty = 0', () => expect(whenSpecificity('')).toBe(0));
  it('single ident = 1', () => expect(whenSpecificity('verseSelected')).toBe(1));
  it('compound > simple', () => {
    expect(whenSpecificity('a && b')).toBeGreaterThan(whenSpecificity('a'));
  });
});

describe('resolveKeybinding', () => {
  it('returns null when no binding matches', () => {
    const wc = new WhenContextService();
    const ev = fakeKeyEvent({ key: 'a' });
    const result = resolveKeybinding(
      { bindings: [], whenContext: wc, isMac: false },
      ev,
      wc.snapshot(),
    );
    expect(result).toBeNull();
  });

  it('matches a single binding', () => {
    const wc = new WhenContextService();
    const ev = fakeKeyEvent({ key: 'p', ctrl: true, shift: true });
    const result = resolveKeybinding(
      {
        bindings: withOrder([{ command: 'palette.open', key: 'Ctrl+Shift+P', source: 'builtin' }]),
        whenContext: wc,
        isMac: false,
      },
      ev,
      wc.snapshot(),
    );
    expect(result).toBe('palette.open');
  });

  it('user beats extension beats builtin', () => {
    const wc = new WhenContextService();
    const ev = fakeKeyEvent({ key: 'k', ctrl: true });
    const result = resolveKeybinding(
      {
        bindings: withOrder([
          { command: 'builtin.cmd', key: 'Ctrl+K', source: 'builtin' },
          { command: 'ext.cmd', key: 'Ctrl+K', source: 'extension' },
          { command: 'user.cmd', key: 'Ctrl+K', source: 'user' },
        ]),
        whenContext: wc,
        isMac: false,
      },
      ev,
      wc.snapshot(),
    );
    expect(result).toBe('user.cmd');
  });

  it('more-specific when clause beats less-specific', () => {
    const wc = new WhenContextService();
    wc.set('verseSelected', true);
    wc.set('editor.focused', true);
    const ev = fakeKeyEvent({ key: 'k', ctrl: true });
    const result = resolveKeybinding(
      {
        bindings: withOrder([
          { command: 'general', key: 'Ctrl+K', source: 'builtin' },
          { command: 'specific', key: 'Ctrl+K', source: 'builtin', when: 'verseSelected && editor.focused' },
        ]),
        whenContext: wc,
        isMac: false,
      },
      ev,
      wc.snapshot(),
    );
    expect(result).toBe('specific');
  });

  it('skips bindings whose when clause is unsatisfied', () => {
    const wc = new WhenContextService();
    const ev = fakeKeyEvent({ key: 'k', ctrl: true });
    const result = resolveKeybinding(
      {
        bindings: withOrder([
          { command: 'specific', key: 'Ctrl+K', source: 'builtin', when: 'verseSelected' },
          { command: 'general', key: 'Ctrl+K', source: 'builtin' },
        ]),
        whenContext: wc,
        isMac: false,
      },
      ev,
      wc.snapshot(),
    );
    expect(result).toBe('general');
  });

  it('mac override binding takes precedence on mac', () => {
    const wc = new WhenContextService();
    const ev = fakeKeyEvent({ key: 'p', meta: true });
    const result = resolveKeybinding(
      {
        bindings: withOrder([
          { command: 'palette.open', key: 'Ctrl+P', mac: 'Cmd+P', source: 'builtin' },
        ]),
        whenContext: wc,
        isMac: true,
      },
      ev,
      wc.snapshot(),
    );
    expect(result).toBe('palette.open');
  });
});
