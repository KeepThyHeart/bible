/**
 * Default `IKeybindingService` implementation. Holds the registered binding
 * list and delegates resolution to `KeybindingResolver`. Listens to a single
 * window-level `keydown` handler that the host attaches in bootstrap.
 *
 * User overrides are persisted via an injected `UserKeybindingsSink` (wired
 * by the host to the `user_keybindings` table over IPC). The service has no
 * direct DB dependency so it stays unit-testable.
 */

import { Emitter } from '../types/Event';
import type { IDisposable } from '../types/Command';
import type { IEvent } from '../types/Event';
import type {
  IKeybindingService,
  KeybindingRegistration,
} from './IKeybindingService';
import type { ICommandRegistry } from './ICommandRegistry';
import type {
  IWhenContextService,
  WhenContextSnapshot,
} from './IWhenContextService';
import { resolveKeybinding } from './KeybindingResolver';

export interface UserKeybindingsSink {
  /** Persist a user-rebind. Replaces any prior user binding for the same command + key. */
  put(command: string, key: string, mac?: string, whenClause?: string): Promise<void>;
  /** Remove a persisted user binding. */
  remove(command: string, key: string): Promise<void>;
  /** Load all user bindings. Called once at startup. */
  loadAll(): Promise<KeybindingRegistration[]>;
}

export interface KeybindingServiceOptions {
  registry: ICommandRegistry;
  whenContext: IWhenContextService;
  userSink?: UserKeybindingsSink;
  isMac?: boolean;
}

interface InternalBinding extends KeybindingRegistration {
  _registrationOrder: number;
}

export class KeybindingService implements IKeybindingService {
  private bindings: InternalBinding[] = [];
  private nextOrder = 0;
  private readonly emitter = new Emitter<void>();
  private readonly registry: ICommandRegistry;
  private readonly whenContext: IWhenContextService;
  private readonly userSink: UserKeybindingsSink | undefined;
  private readonly isMac: boolean;

  readonly onDidChange: IEvent<void> = this.emitter.event;

  constructor(opts: KeybindingServiceOptions) {
    this.registry = opts.registry;
    this.whenContext = opts.whenContext;
    if (opts.userSink) this.userSink = opts.userSink;
    this.isMac = opts.isMac ?? (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform));
  }

  /** One-time bootstrap: load persisted user bindings into the in-memory list. */
  async loadUserBindings(): Promise<void> {
    if (!this.userSink) return;
    try {
      const all = await this.userSink.loadAll();
      for (const b of all) {
        this.bindings.push({ ...b, _registrationOrder: this.nextOrder++ });
      }
      this.emitter.fire();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[keybindings] failed to load user bindings:', err);
    }
  }

  register(binding: KeybindingRegistration): IDisposable {
    const internal: InternalBinding = { ...binding, _registrationOrder: this.nextOrder++ };
    this.bindings.push(internal);
    this.emitter.fire();
    return {
      dispose: () => {
        const idx = this.bindings.indexOf(internal);
        if (idx >= 0) {
          this.bindings.splice(idx, 1);
          this.emitter.fire();
        }
      },
    };
  }

  unregister(command: string, key: string): void {
    const before = this.bindings.length;
    this.bindings = this.bindings.filter((b) => !(b.command === command && b.key === key));
    if (this.bindings.length !== before) this.emitter.fire();
  }

  getBindingsForCommand(command: string): KeybindingRegistration[] {
    const out = this.bindings.filter((b) => b.command === command);
    // Same priority ordering as the resolver: spec'd `when` first, then source rank.
    out.sort((a, b) => {
      const sa = (a.when ?? '').length;
      const sb = (b.when ?? '').length;
      if (sa !== sb) return sb - sa;
      const rank = { user: 3, extension: 2, builtin: 1 } as const;
      return rank[b.source] - rank[a.source];
    });
    return out.map(({ _registrationOrder: _, ...rest }) => rest);
  }

  resolve(event: KeyboardEvent, ctx: WhenContextSnapshot): string | null {
    return resolveKeybinding(
      { bindings: this.bindings, whenContext: this.whenContext, isMac: this.isMac },
      event,
      ctx,
    );
  }

  /** Wire `window.addEventListener('keydown', ...)`. Returns the unsubscribe disposable. */
  attachToWindow(target: Window | EventTarget = window): IDisposable {
    const handler = (ev: Event) => {
      const ke = ev as KeyboardEvent;
      const snap = this.whenContext.snapshot();
      const cmd = this.resolve(ke, snap);
      if (cmd) {
        ke.preventDefault();
        ke.stopPropagation();
        void this.registry.execute(cmd);
      }
    };
    target.addEventListener('keydown', handler as EventListener, { capture: true });
    return {
      dispose: () => {
        target.removeEventListener('keydown', handler as EventListener, { capture: true } as EventListenerOptions);
      },
    };
  }

  async rebind(command: string, newKey: string): Promise<void> {
    // Remove existing user bindings for this command first.
    const userBindingsForCommand = this.bindings.filter(
      (b) => b.command === command && b.source === 'user',
    );
    for (const ub of userBindingsForCommand) {
      const idx = this.bindings.indexOf(ub);
      if (idx >= 0) this.bindings.splice(idx, 1);
      if (this.userSink) {
        try {
          await this.userSink.remove(command, ub.key);
        } catch {
          // best-effort
        }
      }
    }
    const newBinding: InternalBinding = {
      command,
      key: newKey,
      source: 'user',
      _registrationOrder: this.nextOrder++,
    };
    this.bindings.push(newBinding);
    if (this.userSink) {
      try {
        await this.userSink.put(command, newKey);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[keybindings] failed to persist rebind:', err);
      }
    }
    this.emitter.fire();
  }
}
