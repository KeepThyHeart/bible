/**
 * Platform-agnostic session serialization service.
 *
 * Controllers register themselves, then the service can serialize/restore
 * all of them in one call. Replaces the desktop pattern of reaching into
 * 7+ Zustand stores via dynamic require().
 */

/**
 * Any controller/service that can persist its state implements this interface.
 * The state must be JSON-serializable (no Maps, Sets, or class instances).
 */
export interface SerializableController {
  /** Return a plain JSON-serializable snapshot of this controller's state. */
  serializeState(): Record<string, unknown>;
  /** Restore this controller's state from a previously serialized snapshot. */
  restoreState(state: Record<string, unknown>): void;
}

export interface SessionSnapshot {
  version: number;
  timestamp: string;
  controllers: Record<string, Record<string, unknown>>;
}

export class SessionSerializationService {
  private controllers = new Map<string, SerializableController>();

  /** Current schema version. Increment when the shape changes. */
  static readonly SCHEMA_VERSION = 1;

  /**
   * Register a controller under a unique name.
   * Overwrites any previous registration with the same name.
   */
  register(name: string, controller: SerializableController): void {
    this.controllers.set(name, controller);
  }

  /** Unregister a controller. */
  unregister(name: string): void {
    this.controllers.delete(name);
  }

  /** Get a registered controller by name. */
  getController(name: string): SerializableController | undefined {
    return this.controllers.get(name);
  }

  /** Get all registered controller names. */
  getRegisteredNames(): string[] {
    return Array.from(this.controllers.keys());
  }

  /**
   * Serialize all registered controllers into a single snapshot.
   * Controllers that throw during serialization are skipped with a warning.
   */
  serializeAll(): SessionSnapshot {
    const controllers: Record<string, Record<string, unknown>> = {};

    for (const [name, controller] of this.controllers) {
      try {
        controllers[name] = controller.serializeState();
      } catch (error) {
        console.warn(`[SessionSerializationService] Failed to serialize "${name}":`, error);
      }
    }

    return {
      version: SessionSerializationService.SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      controllers
    };
  }

  /**
   * Restore all registered controllers from a snapshot.
   * Controllers that throw during restore are skipped with a warning.
   * Controllers present in the snapshot but not registered are ignored.
   */
  restoreAll(snapshot: SessionSnapshot): void {
    for (const [name, state] of Object.entries(snapshot.controllers)) {
      const controller = this.controllers.get(name);
      if (!controller) continue;

      try {
        controller.restoreState(state);
      } catch (error) {
        console.warn(`[SessionSerializationService] Failed to restore "${name}":`, error);
      }
    }
  }
}
