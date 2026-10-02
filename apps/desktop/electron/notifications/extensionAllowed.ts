/**
 * Whether an extension's reminders may notify: it must be installed, enabled and hold
 * `notifications:schedule`. Before the extension host is ready (`entries` is null) there is
 * nothing to check against, so reminders restored from the state file are allowed.
 */
export interface ExtensionEntryLike {
  id: string;
  entry: { enabled: boolean; grantedPermissions: readonly string[] };
}

export function isExtensionNotifyAllowed(entries: readonly ExtensionEntryLike[] | null, extensionId: string): boolean {
  if (!entries) return true;
  const found = entries.find((e) => e.id === extensionId);
  return !!found && found.entry.enabled && found.entry.grantedPermissions.includes('notifications:schedule');
}
