/**
 * Startup — everything between the process beginning and the first
 * frame.
 *
 * Separated from `index.ts` so it can be run without a terminal. The order
 * matters and is not obvious, so it is stated once here rather than inferred
 * from the call sequence:
 *
 * 1. **Extract the bundled KJV first**, because step 2 has to find it.
 * 2. **Discover modules** across the five roots.
 * 3. **Open `state.db`** and restore the session. After discovery, so a
 *    tab naming a translation that is no longer installed can fall back.
 * 4. **Build the shell** and hand it the reader.
 */
import { App } from './App';
import { Library } from './library';
import { StateStore } from './state';
import {
  bibleHome,
  defaultDiscoveryEnv,
  discoverModules,
  moduleRoots,
  type DiscoveryEnv,
} from '../data/modules';
import { defaultFirstRunHost, ensureBundledKjv, type FirstRunResult } from '../data/firstRun';
import { MainScreen } from '../screens/Main';
import { createTheme, detectColorDepth, type ColorEnvironment, type Theme } from '../term/style';

export interface StartupOptions {
  /** Defaults to the real environment. */
  readonly env?: DiscoveryEnv;
  /** Defaults to the terminal's own capabilities. */
  readonly theme?: Theme;
  /** A reference from the command line — `bible "i cor 9"`. */
  readonly openAt?: string | undefined;
}

export interface Startup {
  readonly app: App;
  readonly library: Library;
  readonly store: StateStore;
  readonly firstRun: FirstRunResult;
  /** Set when `state.db` was unreadable and had to be set aside. */
  readonly recoveredFrom: string | undefined;
}

export async function startup(options: StartupOptions = {}): Promise<Startup> {
  const env = options.env ?? defaultDiscoveryEnv();
  const home = bibleHome(env);

  const firstRun = await ensureBundledKjv({
    host: defaultFirstRunHost(home),
    discovered: discoverModules({ env }),
  });

  // Discovered again, deliberately: the first pass told `ensureBundledKjv` what
  // was already there, and this one has to see what it just wrote.
  const library = Library.open({
    modules: discoverModules({ env }),
    mainDbPath: mainDbPath(env),
  });

  const { store, recoveredFrom } = StateStore.open(home);

  const theme =
    options.theme ??
    createTheme(detectColorDepth(process.env as ColorEnvironment, process.stdout.isTTY === true));

  const app = new App({
    library,
    store,
    theme,
    screen: new MainScreen(),
    startupMessage: startupMessage(firstRun, recoveredFrom),
    openAt: options.openAt,
  });

  return { app, library, store, firstRun, recoveredFrom };
}

/**
 * Said once, on the footer, and dismissed by the first keystroke.
 *
 * Both cases are things the user did not ask for and would otherwise never
 * learn: a module appeared on their disk, or their saved tabs were discarded.
 */
export function startupMessage(
  firstRun: FirstRunResult,
  recoveredFrom: string | undefined,
): string | undefined {
  if (recoveredFrom !== undefined) {
    return `state.db was unreadable and was set aside as ${recoveredFrom} — starting fresh.`;
  }
  if (firstRun.action === 'extracted') {
    return `The bundled King James Version was extracted to ${firstRun.path}.`;
  }
  return undefined;
}

/**
 * `main.db`, if the desktop app has one.
 *
 * Only ever read, and only for the desktop's own book names, so that somebody
 * running both sees the same names in each. The fixed canon in `library.ts`
 * covers its absence exactly, so this is a nicety rather than a requirement.
 */
export function mainDbPath(env: DiscoveryEnv): string | undefined {
  for (const root of moduleRoots(env)) {
    if (root.kind !== 'desktop-user' && root.kind !== 'desktop-bundled') continue;
    // Roots point at `<data>/modules`; `main.db` is its sibling.
    const candidate = root.path.replace(/[\\/]modules$/, '/main.db');
    if (env.exists(candidate)) return candidate;
  }
  return undefined;
}
