/**
 * ExtensionDevConfig - the Developer Mode switch, persisted in the main
 * process. Lives at `{userData}/extensions/dev-config.json`.
 *
 * -- Why this is not a renderer preference -----------------------------------
 * Developer Mode gates one genuinely privileged operation: loading an
 * extension from an arbitrary directory *outside* `data/extensions/`, without
 * copying it, and re-reading that directory whenever it changes. A flag held
 * in the renderer could hide the button, but hiding a button is not a control
 * - the IPC channel would still answer. So the switch lives beside the code
 * that enforces it, and `loadUnpacked` consults it directly rather than
 * trusting a caller-supplied claim.
 *
 * Sync fs mirrors `NetworkConfig` and `DiagnosticsConfig`: a tiny file, read
 * once at startup, written only when the user flips the toggle.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log';

export interface ExtensionDevConfigShape {
  /**
   * When true, the Extensions UI offers "Load unpacked extension..." and the
   * host will run an extension in place from a developer's build directory.
   * Default false - this is opt-in, per install.
   */
  developerMode: boolean;
}

const DEFAULTS: ExtensionDevConfigShape = {
  developerMode: false,
};

export class ExtensionDevConfig {
  private readonly filePath: string;
  private cached: ExtensionDevConfigShape;

  constructor(configPath?: string) {
    this.filePath =
      configPath ?? path.join(app.getPath('userData'), 'extensions', 'dev-config.json');
    this.cached = this.load();
  }

  isDeveloperMode(): boolean {
    return this.cached.developerMode;
  }

  setDeveloperMode(enabled: boolean): void {
    this.cached = { ...this.cached, developerMode: enabled };
    this.persist();
  }

  get(): ExtensionDevConfigShape {
    return { ...this.cached };
  }

  private load(): ExtensionDevConfigShape {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object') return { ...DEFAULTS };
      const shape = parsed as Partial<ExtensionDevConfigShape>;
      return {
        // Anything other than a literal `true` reads as off. A corrupt or
        // hand-edited file must not be able to turn a privileged mode on by
        // accident - the only way in is the toggle.
        developerMode: shape.developerMode === true,
      };
    } catch {
      // Missing file is the normal first-run case, not an error.
      return { ...DEFAULTS };
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.cached, null, 2), 'utf8');
    } catch (err) {
      log.error('[extensions] failed to persist dev config:', err);
    }
  }
}
