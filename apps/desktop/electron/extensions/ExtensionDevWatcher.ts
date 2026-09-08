/**
 * ExtensionDevWatcher - hot-reload for unpacked Developer Mode extensions.
 *
 * The whole point of Developer Mode is the edit -> build -> see-it loop. Without
 * a watcher a developer still has to find the extension in the UI and click
 * Reload after every `npm run build`, which is most of the friction that
 * Developer Mode exists to remove.
 *
 * -- What is watched, and why not everything ---------------------------------
 * Two locations, both non-recursive:
 *
 *   1. The extension root, filtered to `extension.json` - a manifest edit
 *      changes permissions, contributions and the entry path, so it has to
 *      re-read.
 *   2. The directory *containing* the entry file (`dist/` for the standard
 *      scaffold), filtered to the entry's basename.
 *
 * Recursive watching was the obvious alternative and is the wrong tool here.
 * `fs.watch({recursive:true})` has genuinely different support across
 * platforms, and pointing it at a developer's project directory means watching
 * `node_modules` and `src` - thousands of files whose changes are, by
 * definition, not yet built. The bundle is the only artifact the host loads,
 * so the bundle is what to watch.
 *
 * -- Why the directory, not the file -----------------------------------------
 * Watching `dist/main.js` directly looks more precise and breaks in practice:
 * bundlers write to a temp file and rename over the target, which on most
 * platforms leaves the watch bound to the now-unlinked inode. Watching the
 * containing directory and filtering by name survives that.
 *
 * Debouncing is not cosmetic. A single esbuild run emits several events - the
 * bundle, then its sourcemap, sometimes a truncate followed by a write - and
 * reloading on the first one can load a half-written file.
 */

import { watch, type FSWatcher } from 'fs';
import { dirname, isAbsolute, join, resolve, sep } from 'path';
import log from 'electron-log';

/**
 * How long to wait after the last filesystem event before reloading.
 *
 * Long enough to coalesce one build's worth of writes, short enough that the
 * loop still feels immediate.
 */
export const DEFAULT_DEBOUNCE_MS = 300;

export interface ExtensionDevWatcherOpts {
  /** Called when a watched file has settled after a change. */
  onChange(extensionId: string): void;
  /** Override the debounce window. Tests use a short one. */
  debounceMs?: number;
}

interface WatchRecord {
  watchers: FSWatcher[];
  timer: NodeJS.Timeout | undefined;
}

export class ExtensionDevWatcher {
  private readonly records = new Map<string, WatchRecord>();
  private readonly onChange: (extensionId: string) => void;
  private readonly debounceMs: number;

  constructor(opts: ExtensionDevWatcherOpts) {
    this.onChange = opts.onChange;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Start watching one unpacked extension. Replaces any existing watch for the
   * same id, so it is safe to call again after a reload changed `main`.
   *
   * Failures are logged and swallowed: a developer whose watch could not be
   * established should still have a working extension and a manual Reload
   * button, not a failed load.
   */
  watchExtension(extensionId: string, installPath: string, main: string): void {
    this.unwatchExtension(extensionId);

    const root = resolve(installPath);
    const targets = watchTargets(root, main);
    const watchers: FSWatcher[] = [];

    for (const target of targets) {
      try {
        const w = watch(target.dir, { persistent: false }, (_event, filename) => {
          // `filename` is nullable on some platforms. A null name means "something
          // in here changed" and the safe reading is that it was ours.
          if (filename !== null && filename !== undefined) {
            const base = String(filename).split(/[\\/]/).pop();
            if (base !== target.file) return;
          }
          this.schedule(extensionId);
        });
        w.on('error', (err) => {
          log.warn(`[extensions] dev watch error for ${extensionId} at ${target.dir}:`, err);
        });
        watchers.push(w);
      } catch (err) {
        log.warn(`[extensions] could not watch ${target.dir} for ${extensionId}:`, err);
      }
    }

    if (watchers.length === 0) {
      log.warn(`[extensions] no dev watch established for ${extensionId}; reload manually`);
      return;
    }

    this.records.set(extensionId, { watchers, timer: undefined });
    log.info(
      `[extensions] watching ${watchers.length} location(s) for ${extensionId} (${targets.map((t) => join(t.dir, t.file)).join(', ')})`,
    );
  }

  /** Stop watching one extension. Safe to call for an id that is not watched. */
  unwatchExtension(extensionId: string): void {
    const rec = this.records.get(extensionId);
    if (!rec) return;
    if (rec.timer) clearTimeout(rec.timer);
    for (const w of rec.watchers) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
    this.records.delete(extensionId);
  }

  /** Stop everything. Called on host shutdown. */
  dispose(): void {
    for (const id of Array.from(this.records.keys())) this.unwatchExtension(id);
  }

  /** Ids currently being watched - used by tests and diagnostics. */
  watchedIds(): string[] {
    return Array.from(this.records.keys());
  }

  private schedule(extensionId: string): void {
    const rec = this.records.get(extensionId);
    if (!rec) return;
    if (rec.timer) clearTimeout(rec.timer);
    rec.timer = setTimeout(() => {
      rec.timer = undefined;
      // The watch may have been torn down while the timer was pending - a
      // reload that races an uninstall would otherwise resurrect the row.
      if (!this.records.has(extensionId)) return;
      try {
        this.onChange(extensionId);
      } catch (err) {
        log.error(`[extensions] dev reload handler threw for ${extensionId}:`, err);
      }
    }, this.debounceMs);
    // Do not let a pending reload hold the app open at shutdown.
    rec.timer.unref?.();
  }
}

interface WatchTarget {
  dir: string;
  file: string;
}

/**
 * The (directory, filename) pairs to watch for one extension.
 *
 * Exported for testing: which paths get watched is the part most likely to be
 * silently wrong, and it is pure.
 */
export function watchTargets(installPath: string, main: string): WatchTarget[] {
  const root = resolve(installPath);
  const targets: WatchTarget[] = [{ dir: root, file: 'extension.json' }];

  // `main` is validated as package-relative at manifest load, but this module
  // also runs against directories a developer picked by hand. Re-check rather
  // than assume, and simply skip the entry watch if it does not hold - the
  // manifest watch still works and the extension would have failed to load
  // anyway.
  if (typeof main === 'string' && main.length > 0 && !isAbsolute(main) && !/^[a-z]+:/i.test(main)) {
    const entry = resolve(root, main);
    const contained =
      entry !== root && entry.startsWith(root.endsWith(sep) ? root : root + sep);
    if (contained) {
      const dir = dirname(entry);
      const file = entry.slice(dir.length + 1);
      if (dir !== root || file !== 'extension.json') {
        targets.push({ dir, file });
      }
    }
  }

  return targets;
}
