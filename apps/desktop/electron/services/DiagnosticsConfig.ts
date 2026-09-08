/**
 * DiagnosticsConfig - small synchronous JSON config store for the
 * diagnostics subsystem. Lives at `{userData}/diagnostics/config.json`.
 *
 * Sync fs is fine: the file is tiny, it's read once at startup, and writes
 * happen on explicit user interaction (toggling a setting, "don't ask
 * again"). No hot paths touch this.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import {
  DIAGNOSTICS_DEFAULT_ENABLED,
  DIAGNOSTICS_DEFAULT_ENDPOINT,
} from '../config/constants';

export interface DiagnosticsConfigShape {
  enabled: boolean;
  endpointUrl: string;
  dontAskAgain: boolean;
}

const DEFAULTS: DiagnosticsConfigShape = {
  enabled: DIAGNOSTICS_DEFAULT_ENABLED,
  endpointUrl: DIAGNOSTICS_DEFAULT_ENDPOINT,
  dontAskAgain: false,
};

export class DiagnosticsConfig {
  private filePath: string;
  private cached: DiagnosticsConfigShape;

  constructor(configPath?: string) {
    this.filePath =
      configPath ??
      path.join(app.getPath('userData'), 'diagnostics', 'config.json');
    this.cached = this.load();
  }

  private load(): DiagnosticsConfigShape {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DiagnosticsConfigShape>;
      return { ...DEFAULTS, ...parsed };
    } catch {
      return { ...DEFAULTS };
    }
  }

  get(): DiagnosticsConfigShape {
    return { ...this.cached };
  }

  set(patch: Partial<DiagnosticsConfigShape>): DiagnosticsConfigShape {
    this.cached = { ...this.cached, ...patch };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.cached, null, 2),
        'utf-8'
      );
    } catch (err) {
      log.error('[diagnostics] failed to persist config:', err);
    }
    return { ...this.cached };
  }
}
