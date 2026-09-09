/**
 * NetworkConfig - small synchronous JSON config store for the network
 * subsystem. Lives at `{userData}/network/config.json`.
 *
 * Holds the master **Allow web requests** switch. It is OFF on a fresh install
 * and stays off until the user turns it on and confirms a dialog. While off,
 * the `NetworkGateway` refuses every egress attempt before a socket is opened -
 * catalog, module download, diagnostics, the updater and the per-extension
 * gateway all stay dark - and `openExternalUrl` refuses to hand a link to the
 * browser, because opening a link discloses the user's IP to that server just
 * as a fetch does.
 *
 * Not every consumer routes through `NetworkGateway` (electron-updater brings
 * its own HTTP stack). The invariant is not "one socket" but "one switch":
 * every path that can reach the network checks THIS flag before it starts.
 *
 * ## What this does not claim
 *
 * This is a switch the app honors, not a sandbox the OS enforces. It does not
 * stop the operating system, the GPU process, or a native dependency from
 * making its own connections, and it is not a guarantee that a machine running
 * this app emits no traffic. Do not describe it to users as one.
 *
 * Sync fs is fine (mirrors `DiagnosticsConfig`): the file is tiny, read once
 * at startup, and written only on explicit user interaction (the Privacy menu
 * toggle / the network IPC handlers). No hot paths touch this.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log';

export interface NetworkConfigShape {
  /**
   * When true, the app may make network requests. **Default false** - a fresh
   * install goes online for nothing until the user turns this on and confirms.
   *
   * Deliberately phrased positively. The flag it replaced, `offlineMode`,
   * defaulted to `false` meaning "not offline", so the safe state was the one
   * you got by *setting* something - a shape where a dropped write, a parse
   * failure, or a new caller forgetting the check all fail OPEN. `allowNetwork`
   * inverts that: everything that goes wrong lands on `false`, and the app
   * stays quiet.
   */
  allowNetwork: boolean;
}

const DEFAULTS: NetworkConfigShape = {
  allowNetwork: false,
};

/** Legacy shape, read once so an existing install is not silently re-opened. */
interface LegacyNetworkConfigShape {
  offlineMode?: boolean;
}

export class NetworkConfig {
  private filePath: string;
  private cached: NetworkConfigShape;

  constructor(configPath?: string) {
    this.filePath =
      configPath ?? path.join(app.getPath('userData'), 'network', 'config.json');
    this.cached = this.load();
  }

  private load(): NetworkConfigShape {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<NetworkConfigShape> &
        LegacyNetworkConfigShape;

      if (typeof parsed.allowNetwork === 'boolean') {
        return { ...DEFAULTS, allowNetwork: parsed.allowNetwork };
      }

      // Pre-`allowNetwork` config. `offlineMode: true` was an explicit choice to
      // stay offline and is carried over; `offlineMode: false` was the DEFAULT,
      // not a decision, so it is NOT read as consent to go online. Those installs
      // land on `allowNetwork: false` and are asked once, like a fresh install.
      if (parsed.offlineMode === false) {
        log.info('[network] migrating legacy config; re-asking for network consent');
      }
      return { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  get(): NetworkConfigShape {
    return { ...this.cached };
  }

  set(patch: Partial<NetworkConfigShape>): NetworkConfigShape {
    this.cached = { ...this.cached, ...patch };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.cached, null, 2),
        'utf-8'
      );
    } catch (err) {
      log.error('[network] failed to persist config:', err);
    }
    return { ...this.cached };
  }
}
