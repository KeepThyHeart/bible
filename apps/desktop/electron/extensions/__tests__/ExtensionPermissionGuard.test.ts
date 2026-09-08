import { describe, it, expect } from 'vitest';
import { Extensions } from '@bible/core';

const { PermissionDeniedError } = Extensions;
type PermissionDeniedError = Extensions.PermissionDeniedError;
import {
  buildGrant,
  hasPermission,
  requireAnyPermission,
  requirePermission,
} from '../ExtensionPermissionGuard';

describe('ExtensionPermissionGuard', () => {
  it('buildGrant captures id and permissions as a Set', () => {
    const grant = buildGrant('ext.acme.tools', ['bible:read', 'notes:write']);
    expect(grant.extensionId).toBe('ext.acme.tools');
    expect(grant.permissions.has('bible:read')).toBe(true);
    expect(grant.permissions.has('notes:write')).toBe(true);
    expect(grant.permissions.has('storage:secrets')).toBe(false);
  });

  it('requirePermission passes when granted', () => {
    const grant = buildGrant('ext.x.y', ['bible:read']);
    expect(() => requirePermission(grant, 'bible:read')).not.toThrow();
  });

  it('requirePermission throws PermissionDeniedError when missing', () => {
    const grant = buildGrant('ext.x.y', ['bible:read']);
    let caught: unknown;
    try {
      requirePermission(grant, 'notes:write');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PermissionDeniedError);
    const err = caught as PermissionDeniedError;
    expect(err.code).toBe('PermissionDeniedError');
    expect(err.message).toContain('ext.x.y');
    expect(err.message).toContain('notes:write');
    expect((err.data as { permission: string }).permission).toBe('notes:write');
  });

  it('requireAnyPermission accepts when at least one is granted', () => {
    const grant = buildGrant('ext.x.y', ['notes:read']);
    expect(() => requireAnyPermission(grant, ['notes:read', 'notes:write'])).not.toThrow();
  });

  it('requireAnyPermission throws when none are granted', () => {
    const grant = buildGrant('ext.x.y', []);
    expect(() => requireAnyPermission(grant, ['notes:read', 'notes:write'])).toThrow(
      PermissionDeniedError,
    );
  });

  it('hasPermission is a non-throwing predicate', () => {
    const grant = buildGrant('ext.x.y', ['bible:read']);
    expect(hasPermission(grant, 'bible:read')).toBe(true);
    expect(hasPermission(grant, 'notes:write')).toBe(false);
  });
});
