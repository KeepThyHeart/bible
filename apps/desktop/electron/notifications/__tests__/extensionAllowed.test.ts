import { describe, it, expect } from 'vitest';
import { isExtensionNotifyAllowed } from '../extensionAllowed';

const entry = (enabled: boolean, perms: string[]) => ({ id: 'a.b', entry: { enabled, grantedPermissions: perms } });

describe('isExtensionNotifyAllowed', () => {
  it('allows everything before the extension host is ready', () => {
    expect(isExtensionNotifyAllowed(null, 'a.b')).toBe(true);
  });
  it('requires installed, enabled and the notifications:schedule permission', () => {
    expect(isExtensionNotifyAllowed([entry(true, ['notifications:schedule'])], 'a.b')).toBe(true);
    expect(isExtensionNotifyAllowed([entry(false, ['notifications:schedule'])], 'a.b')).toBe(false);
    expect(isExtensionNotifyAllowed([entry(true, ['ui:notification'])], 'a.b')).toBe(false);
    expect(isExtensionNotifyAllowed([], 'a.b')).toBe(false);
  });
});
