/**
 * Arguments for a contributed `verse` menu item's command: the item's own
 * `args` with `verse` - what was right-clicked - merged in. Without it a
 * handler could only guess from the active verse, which a right-click does not
 * change. Non-object `args` cannot carry the key, so they pass unchanged; see
 * `ContextMenuItemDescriptor.args`.
 */
export function withVerseIdsContext(
  args: unknown,
  verseIds: readonly number[],
  module: string,
): unknown {
  const isPlainObject =
    typeof args === 'object' && args !== null && !Array.isArray(args);
  if (args !== undefined && !isPlainObject) return args;
  if (verseIds.length === 0) return args;
  return {
    ...(isPlainObject ? (args as Record<string, unknown>) : {}),
    verse: { verseId: verseIds[0], verseIds: [...verseIds], module },
  };
}
