/**
 * Pure-function resolver that picks the winning binding for a given keystroke
 * + when-context. Kept separate from `KeybindingService` so it's trivially
 * unit-testable without needing a full service instance.
 *
 * Resolution rules (spec sectionResolver priority):
 *  1. Bindings whose `when` clause is more specific (longer expression) win
 *     over more general ones. Empty `when` is the least specific.
 *  2. Within the same specificity, `user` > `extension` > `builtin`.
 *  3. Within the same source, registration order (first wins).
 */

import type { KeybindingRegistration } from './IKeybindingService';
import type { IWhenContextService, WhenContextSnapshot } from './IWhenContextService';

/** A keystroke parsed from a `KeyboardEvent` and normalized to canonical form. */
export interface NormalizedKeystroke {
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/**
 * Normalize a `KeyboardEvent` into a canonical token like `Ctrl+Shift+P`.
 * The token format mirrors the `key` field in `KeybindingDescriptor` and is
 * used to match against registered bindings.
 */
export function eventToToken(ev: KeyboardEvent, isMac: boolean): string {
  const parts: string[] = [];
  if (ev.ctrlKey) parts.push('Ctrl');
  if (ev.altKey) parts.push('Alt');
  if (ev.shiftKey) parts.push('Shift');
  if (ev.metaKey) parts.push(isMac ? 'Cmd' : 'Meta');
  // Normalize the key portion. Letter keys come through as the literal
  // character (a, A); we upper-case for consistency. Special keys keep their
  // event names (Enter, Escape, ArrowLeft, F1, etc.).
  const k = ev.key;
  if (k.length === 1) {
    parts.push(k.toUpperCase());
  } else {
    parts.push(k);
  }
  return parts.join('+');
}

/** Normalize a registered binding token to the same canonical form. */
export function normalizeBindingToken(token: string): string {
  return token
    .split('+')
    .map((p) => p.trim())
    .map((p) => {
      const lower = p.toLowerCase();
      if (lower === 'control' || lower === 'ctrl') return 'Ctrl';
      if (lower === 'option' || lower === 'alt') return 'Alt';
      if (lower === 'shift') return 'Shift';
      if (lower === 'cmd' || lower === 'command' || lower === 'meta') return 'Cmd';
      if (p.length === 1) return p.toUpperCase();
      return p;
    })
    .join('+');
}

/**
 * Compute a relative specificity for a `when` clause. Crude but effective:
 * we count operator and identifier tokens. Empty when-clause = 0.
 */
export function whenSpecificity(when: string | undefined): number {
  if (!when) return 0;
  // Strip whitespace then count meaningful chunks. Identifiers and operators
  // both contribute, so `a && b` (specificity 3) outranks `a` (1).
  const trimmed = when.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+|(?=[!&|=<>])|(?<=[!&|=<>])/).filter(Boolean).length;
}

const SOURCE_RANK: Record<KeybindingRegistration['source'], number> = {
  user: 3,
  extension: 2,
  builtin: 1,
};

export interface ResolverInput {
  /** All registered bindings, in registration order. */
  bindings: ReadonlyArray<KeybindingRegistration & { _registrationOrder: number }>;
  /** Service used to evaluate `when` clauses against the supplied snapshot. */
  whenContext: IWhenContextService;
  isMac: boolean;
}

/**
 * Find the winning command id for a given keystroke + context, or null if
 * none match.
 */
export function resolveKeybinding(
  input: ResolverInput,
  ev: KeyboardEvent,
  ctx: WhenContextSnapshot,
): string | null {
  const token = eventToToken(ev, input.isMac);
  const candidates: Array<KeybindingRegistration & { _registrationOrder: number }> = [];

  for (const b of input.bindings) {
    const want = input.isMac && b.mac ? b.mac : b.key;
    if (normalizeBindingToken(want) !== token) continue;
    if (b.when && !input.whenContext.evaluateAgainst(b.when, ctx)) continue;
    candidates.push(b);
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const sa = whenSpecificity(a.when);
    const sb = whenSpecificity(b.when);
    if (sa !== sb) return sb - sa;
    const ra = SOURCE_RANK[a.source];
    const rb = SOURCE_RANK[b.source];
    if (ra !== rb) return rb - ra;
    return a._registrationOrder - b._registrationOrder;
  });

  return candidates[0]!.command;
}
