/**
 * Extension panel pop-out mapping (`PlatformPlan.md` P2).
 *
 * `PanelContentType` has always included `` `ext:${string}` `` and
 * `PanelContentRenderer` has always routed those to `ExtensionPanelHost` - but
 * `POP_OUT_PANE_TYPE` was a flat record with no `ext:` entry, and
 * `handlePopOut` returns early on a lookup miss. So extension panes could not
 * be popped out, and per `docs/features/pop-out.md` the menu simply left the
 * item off. A pane that cannot leave the dock is a second-class pane, and for
 * anything session-shaped a separate window is the right default rather than a
 * preference.
 *
 * A flat record cannot serve these: the content type embeds the extension id
 * and the panel type id, so there is one per contributed panel and none of
 * them are known until an extension registers. Hence a function, and hence
 * this file - the mapping is the whole of the logic, and the rest is Electron
 * plumbing a unit test cannot reach.
 */

import { describe, it, expect } from 'vitest';

import {
  popOutPaneTypeFor,
  parseExtensionContentType,
} from './DockviewTabRenderer';

describe('popOutPaneTypeFor', () => {
  it('keeps the built-in mappings intact', () => {
    expect(popOutPaneTypeFor('bible')).toBe('bible');
    expect(popOutPaneTypeFor('commentary')).toBe('commentary');
    expect(popOutPaneTypeFor('notes')).toBe('verse-notes');
    // Dictionaries ride in the Books window - `paneKind` in the payload is
    // what makes it a dictionary.
    expect(popOutPaneTypeFor('dictionary')).toBe('book');
  });

  it('maps any extension panel to the single extension window kind', () => {
    expect(popOutPaneTypeFor('ext:ext.bible-app.memory.session')).toBe('extension');
    expect(popOutPaneTypeFor('ext:ext.other.vendor.thing')).toBe('extension');
  });

  it('still refuses content types that have no window', () => {
    // A New Tab page or a search pane has nothing to detach into, and
    // `handlePopOut` relies on undefined here to leave the menu item off.
    expect(popOutPaneTypeFor('newtab')).toBeUndefined();
    expect(popOutPaneTypeFor('search')).toBeUndefined();
  });
});

describe('parseExtensionContentType', () => {
  it('splits on the last dot, because extension ids contain dots', () => {
    // `ext.bible-app.memory` is the extension; `session` is the panel type.
    // Splitting on the first dot would call every extension in existence
    // `ext`.
    expect(parseExtensionContentType('ext:ext.bible-app.memory.session')).toEqual({
      extensionId: 'ext.bible-app.memory',
      panelTypeId: 'session',
    });
  });

  it('handles a single-segment extension id', () => {
    expect(parseExtensionContentType('ext:vendor.panel')).toEqual({
      extensionId: 'vendor',
      panelTypeId: 'panel',
    });
  });

  it('returns null for a non-extension content type', () => {
    expect(parseExtensionContentType('bible')).toBeNull();
  });

  it('returns null for a malformed extension content type', () => {
    // No dot at all: there is no panel type id to address, so detaching would
    // open a window pointing at nothing.
    expect(parseExtensionContentType('ext:noDotHere')).toBeNull();
    // A trailing dot leaves an empty panel type id.
    expect(parseExtensionContentType('ext:ext.a.')).toBeNull();
    // A leading dot leaves an empty extension id.
    expect(parseExtensionContentType('ext:.panel')).toBeNull();
  });

  it('round-trips the content type the store builds', () => {
    // `extensionUiStore.addPanelType` composes exactly this shape; the two must
    // agree or a panel opens under one address and detaches under another.
    const extensionId = 'ext.bible-app.memory';
    const panelTypeId = 'session';
    const contentType = `ext:${extensionId}.${panelTypeId}`;
    expect(parseExtensionContentType(contentType)).toEqual({ extensionId, panelTypeId });
  });
});
