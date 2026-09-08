/**
 * Describes a single keybinding attached to a command at registration time.
 *
 * `key` uses cross-platform tokens (e.g. `Ctrl+J`, `Cmd+Shift+P`). When `mac`
 * is provided it overrides `key` on macOS. `when` is an optional extra
 * `WhenContextService` expression that further constrains the binding beyond
 * the command's own `when` clause.
 */

export interface KeybindingDescriptor {
  key: string;
  mac?: string;
  when?: string;
}
