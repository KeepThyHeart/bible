import { describe, expect, it } from 'vitest';
import { isTyping, resolveShortcutAction } from './usePresenterShortcuts';

function key(overrides: Partial<{
  key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean; repeat: boolean;
}> = {}) {
  return {
    key: 'a',
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides,
  };
}

describe('resolveShortcutAction', () => {
  const noClicker = { hasStaged: true, acceptClickerKeys: false };

  it('ignores a repeated key entirely', () => {
    expect(resolveShortcutAction(key({ altKey: true, key: 'ArrowRight', repeat: true }), noClicker)).toBeNull();
  });

  it('sends with Alt+Enter only when something is staged', () => {
    expect(resolveShortcutAction(key({ altKey: true, key: 'Enter' }), noClicker)).toEqual({ type: 'send' });
    expect(resolveShortcutAction(key({ altKey: true, key: 'Enter' }), { ...noClicker, hasStaged: false }))
      .toBeNull();
  });

  it('steps with Alt+Left/Right', () => {
    expect(resolveShortcutAction(key({ altKey: true, key: 'ArrowRight' }), noClicker)).toEqual({ type: 'next' });
    expect(resolveShortcutAction(key({ altKey: true, key: 'ArrowLeft' }), noClicker)).toEqual({ type: 'previous' });
  });

  it('blanks with Ctrl+Enter', () => {
    expect(resolveShortcutAction(key({ ctrlKey: true, key: 'Enter' }), noClicker)).toEqual({ type: 'toggleBlank' });
  });

  it('does nothing for a bare left/right arrow or letter key when clicker keys are off', () => {
    expect(resolveShortcutAction(key({ key: 'ArrowRight' }), noClicker)).toBeNull();
    expect(resolveShortcutAction(key({ key: 'ArrowLeft' }), noClicker)).toBeNull();
    expect(resolveShortcutAction(key({ key: 'b' }), noClicker)).toBeNull();
  });

  it('steps the study verse on a bare up/down arrow when clicker keys are off', () => {
    expect(resolveShortcutAction(key({ key: 'ArrowDown' }), noClicker))
      .toEqual({ type: 'stepStudy', direction: 'next' });
    expect(resolveShortcutAction(key({ key: 'ArrowUp' }), noClicker))
      .toEqual({ type: 'stepStudy', direction: 'previous' });
  });

  it('ignores a modified up/down arrow even with clicker keys off', () => {
    expect(resolveShortcutAction(key({ key: 'ArrowDown', shiftKey: true }), noClicker)).toBeNull();
    expect(resolveShortcutAction(key({ key: 'ArrowUp', ctrlKey: true }), noClicker)).toBeNull();
  });

  it('never fires a modified combination it does not recognise', () => {
    expect(resolveShortcutAction(key({ altKey: true, ctrlKey: true, key: 'Enter' }), noClicker)).toBeNull();
    expect(resolveShortcutAction(key({ altKey: true, key: 'a' }), noClicker)).toBeNull();
  });

  describe('with a clicker accepted', () => {
    const clicker = { hasStaged: true, acceptClickerKeys: true };

    it('advances on plain Page Down and the right/down arrows', () => {
      for (const k of ['PageDown', 'ArrowRight', 'ArrowDown']) {
        expect(resolveShortcutAction(key({ key: k }), clicker)).toEqual({ type: 'next' });
      }
    });

    it('goes back on plain Page Up and the left/up arrows', () => {
      for (const k of ['PageUp', 'ArrowLeft', 'ArrowUp']) {
        expect(resolveShortcutAction(key({ key: k }), clicker)).toEqual({ type: 'previous' });
      }
    });

    it('blanks on b, B or period -- the PowerPoint black-screen keys', () => {
      for (const k of ['b', 'B', '.']) {
        expect(resolveShortcutAction(key({ key: k }), clicker)).toEqual({ type: 'toggleBlank' });
      }
    });

    it('ignores an otherwise-matching key held with a modifier', () => {
      // A clicker sends these bare; a modifier means something else typed it.
      expect(resolveShortcutAction(key({ key: 'ArrowRight', shiftKey: true }), clicker)).toBeNull();
      expect(resolveShortcutAction(key({ key: 'b', ctrlKey: true }), clicker)).toBeNull();
    });

    it('leaves an unrelated key alone', () => {
      expect(resolveShortcutAction(key({ key: 'a' }), clicker)).toBeNull();
    });
  });
});

describe('isTyping', () => {
  it('is true for the elements a reader could be typing into', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isTyping({ tagName: tag, isContentEditable: false } as unknown as EventTarget)).toBe(true);
    }
    expect(isTyping({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('is false for plain page content, and for no target at all', () => {
    expect(isTyping({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
