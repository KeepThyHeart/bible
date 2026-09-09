import { describe, it, expect } from 'vitest';

import { EXTENSION_API_VERSION, Extensions } from '../index';
import {
  assertErrorCodesInSync,
  DEFAULT_GRANTED_PERMISSIONS,
  EXTENSION_API_ERROR_CODES,
  EXTENSION_POINT_KINDS,
  ExtensionApiError,
  PermissionDeniedError,
  reviveExtensionApiError,
  ORDER_BUILTIN_MAX,
  ORDER_DEFAULT,
  ORDER_PLUGIN_MAX,
  ORDER_PLUGIN_MIN,
  PERM_BIBLE_READ,
  PERM_COMMANDS_REGISTER,
  PERM_NETWORK,
  SEPARATELY_PROMPTED_PERMISSIONS,
  isRpcEnvelope,
  onCommand,
  onView,
} from '../Extensions';

/**
 * Smoke test for the Extensions namespace: confirms it is exported from
 * `@bible/core`, every constant carries the value the contract fixes, the
 * namespace alias re-export is wired, and the helpers behave.
 *
 * These are pure contract assertions - no host runtime is involved.
 */
describe('Extensions contract', () => {
  it('exports EXTENSION_API_VERSION 1.0.0 at the package root', () => {
    expect(EXTENSION_API_VERSION).toBe('1.0.0');
  });

  it('exports the same version through the Extensions namespace alias', () => {
    expect(Extensions.EXTENSION_API_VERSION).toBe(EXTENSION_API_VERSION);
  });

  it('default-granted permissions contain bible:read and commands:register', () => {
    expect(DEFAULT_GRANTED_PERMISSIONS).toContain(PERM_BIBLE_READ);
    expect(DEFAULT_GRANTED_PERMISSIONS).toContain(PERM_COMMANDS_REGISTER);
  });

  it('separately-prompted permissions include network', () => {
    expect(SEPARATELY_PROMPTED_PERMISSIONS).toContain(PERM_NETWORK);
  });

  it('order constants enforce builtin/plugin separation', () => {
    expect(ORDER_BUILTIN_MAX).toBeLessThan(ORDER_PLUGIN_MIN);
    expect(ORDER_DEFAULT).toBeGreaterThanOrEqual(ORDER_PLUGIN_MIN);
    expect(ORDER_DEFAULT).toBeLessThanOrEqual(ORDER_PLUGIN_MAX);
  });

  it('activation event helpers compose correctly', () => {
    expect(onView('bible')).toBe('onView:bible');
    expect(onCommand('ext.greekTools.openLexicon')).toBe(
      'onCommand:ext.greekTools.openLexicon',
    );
  });

  it('isRpcEnvelope accepts well-formed envelopes and rejects junk', () => {
    expect(
      isRpcEnvelope({ kind: 'request', id: 'abc', method: 'bible.getVerse', args: [] }),
    ).toBe(true);
    expect(isRpcEnvelope({ kind: 'response', id: 'abc' })).toBe(true);
    expect(isRpcEnvelope({ kind: 'event', channel: 'verse.activeChanged', payload: null })).toBe(
      true,
    );
    expect(isRpcEnvelope(null)).toBe(false);
    expect(isRpcEnvelope({ kind: 'nope' })).toBe(false);
    expect(isRpcEnvelope('string')).toBe(false);
  });

  it('every extension point has a registered kind', () => {
    const kinds = new Set(Object.values(EXTENSION_POINT_KINDS));
    expect(kinds).toEqual(new Set(['event', 'filter', 'provider']));
    // Spot-check a known filter and a known provider
    expect(EXTENSION_POINT_KINDS['verse.beforeRender']).toBe('filter');
    expect(EXTENSION_POINT_KINDS['verse.decorate']).toBe('provider');
    expect(EXTENSION_POINT_KINDS['app.ready']).toBe('event');
  });

  it('error code tuple contains the spec-mandated names', () => {
    expect(EXTENSION_API_ERROR_CODES).toContain('PermissionDeniedError');
    expect(EXTENSION_API_ERROR_CODES).toContain('NetworkHostNotAllowedError');
    expect(EXTENSION_API_ERROR_CODES).toContain('IncompatibleApiVersionError');
  });

  it('error class hierarchy is in sync with the code tuple', () => {
    expect(() => assertErrorCodesInSync()).not.toThrow();
  });

  it('PermissionDeniedError carries its stable code and is instanceof base', () => {
    const err = new PermissionDeniedError('nope', { perm: 'notes:write' });
    expect(err).toBeInstanceOf(ExtensionApiError);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect(err.code).toBe('PermissionDeniedError');
    expect(err.message).toBe('nope');
    expect(err.data).toEqual({ perm: 'notes:write' });
  });

  it('reviveExtensionApiError reconstructs the matching subclass', () => {
    const revived = reviveExtensionApiError({
      code: 'PermissionDeniedError',
      message: 'over the wire',
    });
    expect(revived).toBeInstanceOf(PermissionDeniedError);
    expect(revived.code).toBe('PermissionDeniedError');
    expect(revived.message).toBe('over the wire');
  });

  it('reviveExtensionApiError falls back to base for unknown codes', () => {
    const revived = reviveExtensionApiError({
      code: 'NewerCodeFromFutureHost',
      message: 'unknown',
    });
    expect(revived).toBeInstanceOf(ExtensionApiError);
    expect(revived.code).toBe('NewerCodeFromFutureHost');
  });
});
