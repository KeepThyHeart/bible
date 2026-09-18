/**
 * Modules — the library: what was found, and where each piece came from.
 *
 * This screen exists because module discovery is *implicit*. Five roots are
 * scanned in a fixed order (DesignSpec §3.2), duplicates collapse on
 * abbreviation and content hash, and modules the desktop app installed are read
 * in place. None of that is visible while reading, so when a translation is
 * missing — or turns out to be a copy the user did not expect — this is the only
 * place that can answer why.
 *
 * Three decisions follow from that:
 *
 * **Nothing usable is omitted, and nothing unusable is hidden.** A module in a
 * format newer than this build understands (§3.5) gets a dimmed row and the
 * reason, not silence. An absent row would look like a missing file and send the
 * user hunting on disk for something that is already there.
 *
 * **The repository half says it does not exist.** DesignSpec §7 defers the
 * catalog and downloader to 1.1; the wireframe's `r repository` would therefore
 * be a key that does nothing. A sentence explaining that nothing goes outbound,
 * and what to do instead, is worth more than a dead button.
 *
 * **A language filter, and a language tag on anything foreign.** The project's
 * module-display rule: show every module together, tagged with its language when
 * that is not the interface language, and offer a filter at the top.
 *
 * The screen never opens a module. Everything shown comes from the descriptor
 * discovery already read, so listing 50 modules costs 50 rows of formatting and
 * no I/O.
 */
import { statSync } from 'node:fs';

import type { Intent } from '../app/input';
import type { DiscoveredModule, ModuleType, RootKind } from '../data/modules';
import { ellipsize, keepVisible, padTo, wrapText } from '../term/layout';
import type { Key } from '../term/keys';
import type { StyledLine } from '../term/style';
import type { Screen, ScreenAction, ScreenContext, ScreenView } from './types';

export interface ModulesOptions {
  /**
   * The interface language. A module in any other language is tagged, per the
   * project's module-display rule. English until the CLI has a locale of its own.
   */
  readonly uiLanguage?: string;
  /** Injected in tests, which have no files behind their fake modules. */
  readonly fileSize?: (path: string) => number | undefined;
}

/** The five roots of DesignSpec §3.2, in the order they are searched. */
export const SEARCH_ORDER: ReadonlyArray<{
  readonly kind: RootKind;
  readonly path: string;
  readonly what: string;
}> = [
  { kind: 'override', path: '$BIBLE_HOME/modules', what: 'explicit override' },
  { kind: 'cli', path: '~/.bible/modules', what: 'yours — the only one bible writes to' },
  { kind: 'desktop-user', path: '<desktop userData>', what: 'found by shape, never by name' },
  { kind: 'desktop-bundled', path: '<desktop resources>', what: 'whatever the installer shipped' },
  { kind: 'repo', path: 'data/modules', what: 'only when run from a checkout' },
];

const ROOT_LABEL: Readonly<Record<RootKind, string>> = {
  override: 'BIBLE_HOME',
  cli: '~/.bible',
  'desktop-user': 'desktop',
  'desktop-bundled': 'installed',
  repo: 'checkout',
};

const TYPE_LABEL: Readonly<Record<ModuleType | 'unknown', string>> = {
  bible: 'Bible',
  commentary: 'Commentary',
  cross_reference: 'Cross-refs',
  dictionary: 'Dictionary',
  topical_index: 'Topics',
  book: 'Book',
  devotional: 'Devotional',
  lexicon: 'Lexicon',
  tag_graph: 'Tags',
  unknown: 'unknown',
};

export function rootLabel(kind: RootKind): string {
  return ROOT_LABEL[kind];
}

/**
 * Why a module cannot be used, or `undefined` when it can.
 *
 * Two distinct cases, and they are not the same failure. `unsupported` is a
 * declared schema this build does not understand — the module is fine and a
 * newer `bible` will read it. An unknown *type* means the filename prefix maps
 * to nothing, so no repository will ever be built over it, whatever its schema
 * says.
 */
export function moduleProblem(module: DiscoveredModule): string | undefined {
  if (module.unsupported !== undefined) return module.unsupported;
  if (module.type === 'unknown') {
    return 'unrecognised filename prefix — nothing knows how to open it';
  }
  return undefined;
}

/** `632 MB`. Binary units, one decimal below 10, none above. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal only where it carries information: `1.8 MB` is worth saying,
  // `632.0 MB` and `1.0 KB` are not.
  const tenths = Math.round(value * 10) / 10;
  const rounded =
    unit === 0 || value >= 10
      ? Math.round(value).toString()
      : Number.isInteger(tenths)
        ? tenths.toString()
        : tenths.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

/** `^O` from anywhere. Wired by the shell; see the note in `Tabs.tabSwitchAction`. */
export function modulesShortcut(key: Key): ScreenAction | undefined {
  if (key.ctrl && key.name === 'char' && key.char === 'o') {
    return { kind: 'open', screen: new Modules() };
  }
  return undefined;
}

export class Modules implements Screen {
  readonly name = 'modules';

  private readonly uiLanguage: string;
  private readonly fileSize: (path: string) => number | undefined;
  private selected = 0;
  /** Rows of the body scrolled past. A large library is longer than the frame. */
  private offset = 0;
  /** `undefined` means every language. */
  private language: string | undefined;

  constructor(options: ModulesOptions = {}) {
    this.uiLanguage = (options.uiLanguage ?? 'en').toLowerCase();
    this.fileSize = options.fileSize ?? defaultFileSize;
  }

  view(ctx: ScreenContext): ScreenView {
    const all = ctx.library.allModules();
    const rows = this.visible(all);
    const selected = this.resolve(rows.length);
    const layout = tableLayout(ctx.bodyWidth);

    const content: StyledLine[] = [
      [{ text: header(layout), style: ctx.theme.muted }],
      ...rows.map((module, index): StyledLine => {
        const problem = moduleProblem(module);
        return [
          {
            text: moduleRow(module, this.tagFor(module), this.fileSize(module.path), layout),
            // Dimmed, not hidden: the row is the answer to "where did my module
            // go", and the reason is in the box below.
            style: index === selected ? ctx.theme.cursorVerse : problem ? ctx.theme.muted : undefined,
          },
        ];
      }),
      ...(rows.length === 0 ? [emptyRow(ctx, all.length)] : []),
      [],
      ...this.searchedInOrder(ctx, all),
      [],
      ...this.repositoryNote(ctx),
    ];

    const current = rows[selected];
    const detail = current === undefined ? [] : this.detail(ctx, current);

    // The body is sized to what survives the provenance box and scrolled here,
    // so the search order and the repository note are reachable rather than cut
    // off the bottom of a 24-row terminal without a word.
    const window = Math.max(1, ctx.bodyHeight - (detail.length === 0 ? 0 : detail.length + 2));
    const offset = Math.min(Math.max(this.offset, 0), Math.max(0, content.length - window));
    const hints = this.hints(current);

    return {
      title: 'modules',
      status: this.status(all, rows),
      body: content.slice(offset, offset + window),
      overlay:
        current === undefined
          ? undefined
          : { title: `${current.abbreviation} — ${current.fullName}`, rows: detail },
      hints: content.length > window ? `${hints}  pgup/pgdn scroll` : hints,
    };
  }

  key(key: Key, ctx: ScreenContext): ScreenAction {
    const rows = this.visible(ctx.library.allModules());

    switch (key.name) {
      case 'up':
        return this.move(ctx, -1, rows.length);
      case 'down':
        return this.move(ctx, 1, rows.length);
      case 'home':
        return this.move(ctx, -rows.length, rows.length);
      case 'end':
        return this.move(ctx, rows.length, rows.length);
      case 'pageup':
      case 'pagedown':
        return this.page(key.name === 'pagedown' ? 1 : -1, ctx);
      default:
        break;
    }

    // Single keys, free because a printable only reaches a screen while the input
    // line is closed.
    if (key.name !== 'char' || key.ctrl || key.alt) return { kind: 'none' };

    if (key.char === 'l') {
      this.language = nextLanguage(ctx.library.allModules(), this.language);
      this.selected = 0;
      return { kind: 'redraw' };
    }

    if (key.char === 'r') {
      return { kind: 'message', text: REPOSITORY_ONE_LINER };
    }

    return { kind: 'none' };
  }

  submit(intent: Intent, ctx: ScreenContext): ScreenAction {
    if (intent.kind !== 'empty') {
      return {
        kind: 'message',
        text: 'esc goes back to the passage — references and searches belong there.',
      };
    }

    const rows = this.visible(ctx.library.allModules());
    const module = rows[this.resolve(rows.length)];
    if (module === undefined) return { kind: 'none' };

    const problem = moduleProblem(module);
    if (problem !== undefined) {
      return { kind: 'message', text: `${module.abbreviation}: ${problem}`, tone: 'error' };
    }

    // `↵` reads the selected translation *here*, which is the one thing this
    // screen can usefully do to a module. Installing and removing is the
    // desktop app's job for modules it owns, and there is no repository to
    // install from (§7) — so the wireframe's "↵ install/remove" would have been
    // a key that does nothing.
    if (module.type === 'bible') {
      return {
        kind: 'closeTo',
        tab: { ...ctx.tab, translation: module.abbreviation, scrollOffset: 0 },
      };
    }

    return {
      kind: 'message',
      text: `${module.abbreviation} is a ${TYPE_LABEL[module.type].toLowerCase()} — it is offered by the study menu for whichever verse you are on.`,
    };
  }

  // --- helpers -----------------------------------------------------------

  private page(direction: 1 | -1, ctx: ScreenContext): ScreenAction {
    const window = Math.max(1, ctx.bodyHeight - 6);
    const next = Math.max(0, this.offset + direction * window);
    if (next === this.offset) return { kind: 'none' };
    this.offset = next;
    return { kind: 'redraw' };
  }

  /**
   * Move the selection, dragging the scroll with it only when it has to.
   *
   * Adjusted here rather than derived in `view` so that an explicit `pgdn` — the
   * way to reach the search order and the repository note — is not undone on the
   * next render by a pin to a selection that never moved.
   */
  private move(ctx: ScreenContext, delta: number, count: number): ScreenAction {
    if (count === 0) return { kind: 'none' };
    const next = Math.min(Math.max(this.selected + delta, 0), count - 1);
    if (next === this.selected) return { kind: 'none' };
    this.selected = next;
    this.offset = keepVisible(this.offset, 1 + next, Math.max(1, ctx.bodyHeight - 6));
    return { kind: 'redraw' };
  }

  private resolve(count: number): number {
    return Math.min(Math.max(this.selected, 0), Math.max(0, count - 1));
  }

  private visible(all: readonly DiscoveredModule[]): readonly DiscoveredModule[] {
    if (this.language === undefined) return all;
    return all.filter((m) => m.language.toLowerCase() === this.language);
  }

  /** `[ES]`, and nothing at all for the interface language. */
  private tagFor(module: DiscoveredModule): string {
    const language = module.language.toLowerCase();
    return language === this.uiLanguage ? '' : `[${module.language.toUpperCase()}] `;
  }

  private status(all: readonly DiscoveredModule[], rows: readonly DiscoveredModule[]): string {
    const places = new Set(all.map((m) => m.root.path)).size;
    const total = all.reduce((sum, m) => sum + (this.fileSize(m.path) ?? 0), 0);
    const scope = this.language === undefined ? '' : ` · ${this.language} only, ${rows.length} shown`;
    return `${all.length} found in ${places} place${places === 1 ? '' : 's'} · ${formatBytes(total)}${scope}`;
  }

  private hints(current: DiscoveredModule | undefined): string {
    const enter =
      current !== undefined && current.type === 'bible' && moduleProblem(current) === undefined
        ? '↵ read it here  '
        : '';
    return `↑↓ move  ${enter}l language  esc back`;
  }

  private detail(ctx: ScreenContext, module: DiscoveredModule): StyledLine[] {
    const width = Math.max(10, ctx.bodyWidth - 4 - 11);
    const problem = moduleProblem(module);

    const rows: Array<[string, string]> = [
      ['From', `${rootLabel(module.root.kind)} — ${module.root.path}`],
      ['File', module.path],
      [
        'Language',
        module.language + (module.textDirection === 'rtl' ? ' · right to left' : ''),
      ],
      ['Format', module.schemaVersion ?? 'unversioned (an early module)'],
    ];

    const lines = rows.map(([label, text]): StyledLine => [
      { text: padTo(label, 11), style: ctx.theme.muted },
      { text: ellipsize(text, width) },
    ]);

    if (problem !== undefined) {
      for (const line of wrapText(`Unusable: ${problem}`, { width: ctx.bodyWidth - 4 })) {
        lines.push([{ text: line, style: ctx.theme.error }]);
      }
    }

    if (module.root.kind === 'desktop-user' || module.root.kind === 'desktop-bundled') {
      const note =
        'Read in place, never copied and never written to. Removing it is the desktop app’s job.';
      for (const line of wrapText(note, { width: ctx.bodyWidth - 4 })) {
        lines.push([{ text: line, style: ctx.theme.muted }]);
      }
    }

    return lines;
  }

  /**
   * The five roots, with the ones that actually contributed marked.
   *
   * Listed from the fixed table rather than from a fresh filesystem probe: the
   * order is what the user needs to understand a duplicate, and re-scanning the
   * disk on every keystroke to discover that four of the five are absent would
   * be work done for nothing.
   */
  private searchedInOrder(ctx: ScreenContext, all: readonly DiscoveredModule[]): StyledLine[] {
    const paths = new Map<RootKind, string>();
    const counts = new Map<RootKind, number>();
    for (const module of all) {
      paths.set(module.root.kind, module.root.path);
      counts.set(module.root.kind, (counts.get(module.root.kind) ?? 0) + 1);
    }

    // The path column is wide enough for the longest of the five at 88 columns
    // and shrinks with the terminal, so the two columns always total the body
    // width exactly rather than overshooting it on a narrow screen.
    const pathWidth = Math.min(31, Math.max(12, ctx.bodyWidth - 20));
    const restWidth = Math.max(4, ctx.bodyWidth - 2 - pathWidth);

    const lines: StyledLine[] = [[{ text: 'SEARCHED, IN ORDER', style: ctx.theme.title }]];
    for (const root of SEARCH_ORDER) {
      const count = counts.get(root.kind);
      const found = count === undefined ? root.what : `${count} from ${paths.get(root.kind) ?? ''}`;
      lines.push([
        {
          text: `  ${padTo(ellipsize(root.path, pathWidth - 1), pathWidth)}`,
          style: count === undefined ? ctx.theme.muted : undefined,
        },
        { text: ellipsize(found, restWidth), style: ctx.theme.muted },
      ]);
    }
    lines.push([
      {
        text: ellipsize(
          'Duplicates collapse on abbreviation and content hash; the earlier path wins.',
          ctx.bodyWidth,
        ),
        style: ctx.theme.muted,
      },
    ]);
    return lines;
  }

  private repositoryNote(ctx: ScreenContext): StyledLine[] {
    const lines: StyledLine[] = [[{ text: 'REPOSITORY', style: ctx.theme.title }]];
    for (const line of wrapText(REPOSITORY_NOTE, { width: ctx.bodyWidth, firstIndent: 2, hangingIndent: 2 })) {
      lines.push([{ text: line, style: ctx.theme.muted }]);
    }
    return lines;
  }
}

const REPOSITORY_ONE_LINER =
  'There is no repository in this version — browsing and downloading are deferred to 1.1.';

const REPOSITORY_NOTE =
  'Not in this version. Browsing a catalog and downloading modules are deferred to 1.1, ' +
  'so there is no button here that would do nothing. Nothing goes outbound. To add a ' +
  'module, drop its .db file into ~/.bible/modules/ and restart, or install the desktop ' +
  'app — its library is found automatically and read in place.';

// --- rendering -------------------------------------------------------------

interface TableLayout {
  readonly abbreviation: number;
  readonly name: number;
  readonly type: number;
  readonly size: number;
  readonly from: number;
}

/**
 * Columns are dropped from the right as the terminal narrows, rather than
 * squeezed until every one of them is useless. `FROM` goes first, then `SIZE`,
 * then `TYPE`; the abbreviation and the name are what identify a module and
 * they are the last to go.
 */
function tableLayout(width: number): TableLayout {
  // Nine, not seven: `ANDERSON` is a real abbreviation in a shipped module, and
  // an abbreviation truncated to six characters identifies nothing.
  const abbreviation = 9;
  const name = 8; // the minimum the name is allowed to shrink to
  let type = 12;
  let size = 9;
  let from = 11;

  if (width < abbreviation + name + type + size + from) from = 0;
  if (width < abbreviation + name + type + size) size = 0;
  if (width < abbreviation + name + type) type = 0;

  return {
    abbreviation,
    name: Math.max(name, width - abbreviation - type - size - from),
    type,
    size,
    from,
  };
}

function header(layout: TableLayout): string {
  return columns([
    ['ABBR', layout.abbreviation],
    ['NAME', layout.name],
    ['TYPE', layout.type],
    ['SIZE', layout.size],
    ['FROM', layout.from],
  ]);
}

function moduleRow(
  module: DiscoveredModule,
  tag: string,
  bytes: number | undefined,
  layout: TableLayout,
): string {
  return columns([
    [module.abbreviation.toUpperCase(), layout.abbreviation],
    [`${tag}${module.fullName}`, layout.name],
    [TYPE_LABEL[module.type], layout.type],
    [formatBytes(bytes), layout.size],
    [rootLabel(module.root.kind), layout.from],
  ]);
}

/**
 * See the note on `Tabs.columns` — every cell is cut before `padTo` can throw.
 * A zero-width column has been dropped by {@link tableLayout} and disappears
 * rather than becoming an empty gap.
 */
function columns(cells: ReadonlyArray<readonly [text: string, width: number]>): string {
  const kept = cells.filter(([, width]) => width > 0);
  return kept
    .map(([text, width], index) =>
      index === kept.length - 1 ? ellipsize(text, width) : padTo(ellipsize(text, width - 1), width),
    )
    .join('');
}

function emptyRow(ctx: ScreenContext, total: number): StyledLine {
  return [
    {
      text: total === 0 ? '  no modules found.' : '  nothing in this language.',
      style: ctx.theme.muted,
    },
  ];
}

/** The languages present, in first-seen order, cycled through by `l`. */
function nextLanguage(
  all: readonly DiscoveredModule[],
  current: string | undefined,
): string | undefined {
  const languages: string[] = [];
  for (const module of all) {
    const language = module.language.toLowerCase();
    if (!languages.includes(language)) languages.push(language);
  }
  if (languages.length <= 1) return undefined;

  const index = current === undefined ? -1 : languages.indexOf(current);
  // Past the end is "all languages" again, so the cycle always has a way out.
  return index + 1 >= languages.length ? undefined : languages[index + 1];
}

function defaultFileSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    // A module discovered a moment ago can be gone by now — a removable drive,
    // a desktop update mid-flight. A missing size is not worth an error screen.
    return undefined;
  }
}
