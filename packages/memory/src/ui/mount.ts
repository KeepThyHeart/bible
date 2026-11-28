/**
 * Mounts the Scripture Memory UI into a host element.
 *
 * Replaces the extension's `panel.ts`. This is the only file that knows about
 * the core API, the clock, or which screen is showing. The views are handed a
 * `PanelHost` (see `host.ts`) and can do nothing except through it, which
 * keeps the number of places that can start a session or fire a request down
 * to one.
 *
 * Everything that was module-level state in the panel (navigation, the
 * practice view, the recite screen, the render ticket, the status timer) is
 * per-mount here, so two mounts never share state and `dispose()` leaves
 * nothing behind. The UI talks to the core through a `MemoryApi` object (the
 * desktop IPC client, or a fake in tests) and receives its pushes through
 * `subscribe`.
 */

import type { MemoryApi, MemoryPush } from '../core/api';
import type { PanelReply, PanelRequest, PassageView, PlanView, ReciteAction, ReciteStateView, RequestMap, Rung } from '../core/types';
import { clear, el } from './dom';
import { errorBanner } from './components';
import { perfRequestStart, perfScreenEnd, perfScreenStart, perfStartLongTasks } from './perf';
import type { VerseSelectorPort } from './verseSelectorPort';
import type { PanelHost } from './host';
import { WordMeasurer } from './measure';
import { PracticeView } from './practiceView';
import { renderToday } from './todayView';
import { renderHome } from './homeView';
import type { HomeExtras } from './homeView';
import { renderMyVerses } from './myVersesView';
import { renderLists } from './listsView';
import { renderStarterBrowser } from './starterBrowser';
import { getDataCache, scopedView } from './dataCache';
import type { MemoryDataCache } from './dataCache';
import { reciteEnabled } from '../core/features';
import { renderVersePage } from './versePage';
import { renderSettings, updateSpeechBanner } from './settingsView';
import { createReciteView } from './reciteView';
import { createHandsFreeView } from './handsFreeView';
import { startReciteRun } from './activities';
import { renderCardStack } from './cardView';
import { flowRemaining, flowScope, planNextTarget } from './flows';
import type { PracticeTarget } from './flows';
import { createShell } from './shell';
import type { ShellAction } from './shell';
import { countStartedToday, startOfLocalDay } from '../core/today';
import { INITIAL_NAV, navReduce, sameScreen, sameView } from './state';
import type { Flow, NavAction, NavState } from './state';
import { setUiTranslator, tr } from './i18n';
import type { Translate } from './i18n';
import './memory.css';

/** The just-added verse offered on Home (with how the add went, when known). */
export type JustAdded = NonNullable<HomeExtras['justAdded']>;

export interface MemoryUiOptions {
  /** The core (desktop: IPC client; tests: a fake). */
  api: MemoryApi;
  /** Core pushes. Returns the unsubscribe function. */
  subscribe(listener: (push: MemoryPush) => void): () => void;
  /** 'card' = open the push-card stack first (notification click). */
  initialView?: 'today' | 'plan' | 'card';
  /** Start practicing this verse right after mount (a host's "Practice now"). */
  initialPractice?: number;
  /** Show the "Added {reference} to Memory. Practice now" row on Home. */
  justAdded?: JustAdded;
  /** The reader's current reference, for the add field placeholder. */
  activeReference?: string | null;
  /** Clock; default `Date.now`. */
  now?(): number;
  /** The host's translator (catalog lookup); default: the built-in English. */
  t?: Translate;
  /** BCP-47 tag for dates and numbers; default: the runtime's. */
  locale?: string;
  /** The reusable verse selector (`@bible/ui` `mountVerseSelector`); absent: a plain text field. */
  verseSelector?: VerseSelectorPort;
  /** The page heading; default "Memory". */
  title?: string;
  /** Buttons at the end of the title row (desktop: "Back to Study"). */
  actions?: readonly ShellAction[];
}

export interface MemoryUiHandle {
  /** Unsubscribe, destroy the practice view, clear timers, empty the container. */
  dispose(): void;
  /** Same as a `showCard` push. */
  showCards(): void;
  /** Replaces the old `activeVerse` push. */
  setActiveReference(reference: string | null): void;
  /** Start practicing one verse (flow `verse`); only announces when a session or recite is open. */
  practice(passageId: number): void;
  /** Show the "Added {reference}. Practice now" row on Home. */
  offerPractice(added: JustAdded): void;
}

/**
 * Sends a request through the typed API and always resolves - never rejects.
 *
 * `api[type]` is called with the request minus `type` (no argument when
 * nothing else is left). A resolved value comes back as `{ ok: true, data }`;
 * a rejection (the core throws a user-readable `Error`) as
 * `{ ok: false, error: message }`. Every screen therefore has exactly one error
 * path to render and none can silently swallow one.
 */
export async function requestVia<R extends PanelRequest>(
  api: MemoryApi,
  request: R,
): Promise<PanelReply<RequestMap[R['type']]>> {
  const perfDone = perfRequestStart(request.type);
  try {
    const { type, ...args } = request as PanelRequest & Record<string, unknown>;
    const method = (api as unknown as Record<string, (a?: unknown) => Promise<unknown>>)[type];
    if (typeof method !== 'function') {
      return { ok: false, error: `Unknown request "${type}".` };
    }
    const data = Object.keys(args).length === 0 ? await method.call(api) : await method.call(api, args);
    return { ok: true, data } as PanelReply<RequestMap[R['type']]>;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) } as PanelReply<RequestMap[R['type']]>;
  } finally {
    perfDone();
  }
}

function isRunning(state: ReciteStateView): boolean {
  return state.phase !== 'summary' && state.phase !== 'done' && state.phase !== 'error';
}

export function mountMemoryUi(container: HTMLElement, options: MemoryUiOptions): MemoryUiHandle {
  const stopLongTasks = perfStartLongTasks();
  const { api } = options;
  setUiTranslator(options.t, options.locale);
  const now = options.now ?? (() => Date.now());
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;

  container.classList.add('sm-app');
  clear(container);
  const main = el('div', { class: 'sm-main' });
  const status = el('div', { class: 'sm-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  container.appendChild(main);
  container.appendChild(status);

  // -------------------------------------------------------------------------
  // State (per mount)
  // -------------------------------------------------------------------------

  let nav: NavState = INITIAL_NAV;
  let practice: PracticeView | null = null;
  let activeReference: string | null = options.activeReference ?? null;
  let disposed = false;
  /** The verse the Home screen offers to practice (A9); cleared once Home is left. */
  let justAdded: JustAdded | null = options.justAdded ?? null;
  /** Local day the screen was last drawn for, for the midnight re-render. */
  let dayKey = startOfLocalDay(now());
  let dayTimer: number | undefined;

  /** The mounted recite / hands-free screen (at most one), and the last state it was given. */
  let reciteScreen: { element: HTMLElement; update(state: ReciteStateView): void } | null = null;
  let reciteState: ReciteStateView | null = null;

  /**
   * Guards against an out-of-order paint.
   *
   * Every screen fetches its own data, so two quick navigations can leave two
   * requests in flight; without this the slower one wins and paints a screen the
   * user has already left. Each render takes a ticket and discards its result if
   * a newer one has been issued in the meantime.
   */
  let renderToken = 0;

  /** The view last painted by `render()`, to tell a new screen from a refresh. */
  let lastPainted: NavState['view'] | null = null;

  function scrollToTop(): void {
    if (shell.root.scrollTop !== 0) shell.root.scrollTop = 0;
    for (let node: HTMLElement | null = main; node !== null && node !== doc.body; node = node.parentElement) {
      if (node.scrollTop !== 0) node.scrollTop = 0;
    }
  }

  const measurer = new WordMeasurer(doc);

  /** The module-level data cache for this api: it outlives the mount (design-r2 1b). */
  const data: MemoryDataCache = getDataCache(api);
  const cachedAtMount = data.get() !== null;

  /** `refreshSpeech` goes out once per 5 minutes per mount, after a recite surface is drawn. */
  let lastSpeechRefresh = Number.NEGATIVE_INFINITY;
  let speechTimer: number | undefined;
  let speechForce = false;
  /** `force` (Settings) bypasses the 5-minute throttle and the host's probe cache, so its status is fresh. */
  function requestSpeechRefresh(force = false): void {
    if (disposed || !reciteEnabled()) return;
    const t = now();
    if (force) speechForce = true;
    if (speechTimer !== undefined) return;
    if (!force && t - lastSpeechRefresh < 300_000) return;
    lastSpeechRefresh = t;
    const send = (): void => {
      speechTimer = undefined;
      const f = speechForce;
      speechForce = false;
      if (!disposed) void requestVia(api, f ? { type: 'refreshSpeech', force: true } : { type: 'refreshSpeech' });
    };
    const ric = (win as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    speechTimer = typeof ric === 'function' ? ric.call(win, send) : win.setTimeout(send, 500);
  }

  let renderQueued = false;
  /** Coalesces the cache's notifications and explicit reloads into one redraw. */
  function scheduleRender(): void {
    if (renderQueued || disposed) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      void render();
    });
  }

  function refreshData(): void {
    data.refresh().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Status line
  // -------------------------------------------------------------------------

  let statusTimer: number | undefined;

  /**
   * A transient line at the foot of the panel.
   *
   * `aria-live="polite"` on a region that is always in the document - the same
   * reason as in `practiceView.ts`: a live region created at the same instant as
   * its content is frequently not announced at all.
   */
  function announce(message: string): void {
    if (disposed) return;
    status.textContent = message;
    status.classList.remove('sm-status-error');
    win.clearTimeout(statusTimer);
    statusTimer = undefined;
    if (message === '') return;
    statusTimer = win.setTimeout(() => {
      status.textContent = '';
      statusTimer = undefined;
    }, 6000);
  }

  function showError(message: string): void {
    announce(message);
    status.classList.add('sm-status-error');
  }

  // -------------------------------------------------------------------------
  // The host handed to every view
  // -------------------------------------------------------------------------

  const host: Required<Pick<PanelHost, 'startTarget'>> & PanelHost = {
    now,

    request<R extends PanelRequest>(request: R): Promise<PanelReply<RequestMap[R['type']]>> {
      return requestVia(api, request);
    },

    go(action: NavAction): void {
      // Practice and recite change resume points without any push: reload the cache on the way out.
      if (action.type === 'sessionEnded' || action.type === 'stopForToday' || action.type === 'reciteEnded') refreshData();
      const next = navReduce(nav, action);
      leaveExercise(nav, next, action);
      const changed = !sameView(next.view, nav.view) || !sameView(next.returnTo, nav.returnTo);
      nav = next;
      if (changed) void render();
    },

    reload(): void {
      // The cache first, then the redraw (the cache's own notification coalesces with this one).
      void data.refresh().then(scheduleRender, scheduleRender);
    },

    data,

    get verseSelector(): VerseSelectorPort | undefined {
      return options.verseSelector;
    },

    measurer,

    get activeReference(): string | null {
      return activeReference;
    },

    overlayRoot: container,

    async startSession(
      passageId: number,
      rung?: Rung,
      restart?: boolean,
      tier?: number,
      flow?: Flow,
    ): Promise<void> {
      await startSessionImpl(passageId, rung, restart, tier, flow);
    },

    async startFlow(flow: Flow): Promise<boolean> {
      let all: PlanView;
      try {
        all = await data.ensure();
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
        return false;
      }
      // The new-verse cap counts every list; the queue follows the flow's list, else the focus.
      const plan = scopedView(all, flowScope(flow, all.focus ?? 'all'), host.now());
      const startedToday = countStartedToday(all.passages, host.now());
      const opts = flow.kind === 'today' ? { startedToday } : {};
      const target = planNextTarget(plan, flow, host.now(), Math.random, opts);
      if (!target) {
        announce(tr('memory.ui.settings.nothingElseToPractice', 'Nothing else to practice right now.'));
        return false;
      }
      let started = flow;
      if (flow.kind !== 'verse' && flow.startTotal === undefined) {
        // Remembered the first time, so the queue bar's total survives skips.
        const startTotal = flowRemaining(plan, flow, host.now(), opts);
        if (startTotal !== null) started = { ...flow, startTotal };
      }
      return host.startTarget(target, started);
    },

    async startTarget(target: PracticeTarget, flow: Flow): Promise<boolean> {
      // Recite is not a practice session: it has its own runner.
      if (target.rung === 'recite') {
        const run = await startReciteRun(host, { kind: 'passage', passageId: target.passageId }, 'tap');
        return run !== null;
      }
      return startSessionImpl(target.passageId, target.rung, undefined, undefined, flow);
    },

    openInBible(verseId: number): void {
      void requestVia(api, { type: 'navigateTo', verseId }).then((reply) => {
        if (!reply.ok) showError(reply.error);
      });
    },

    announce,
    fail: showError,
  };

  // The shell is drawn at once and stays: screens (practice and recite too) fill its panel.
  const shell = createShell(host, {
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.actions !== undefined ? { actions: options.actions } : {}),
  });
  main.appendChild(shell.root);

  /**
   * Leaving practice or recite some other way than its own Close (a tab, a host request): end the core
   * session, or stop a recite run that is still going (a hands-free loop must not keep listening), and
   * reload the cache, as Close does.
   */
  function leaveExercise(from: NavState, to: NavState, action: NavAction): void {
    const v = from.view;
    if (v.name === 'practice' && to.view.name !== 'practice' && action.type !== 'sessionEnded' && action.type !== 'stopForToday') {
      void requestVia(api, { type: 'endSession', sessionId: v.sessionId });
      refreshData();
    } else if (v.name === 'recite' && to.view.name !== 'recite' && action.type !== 'reciteEnded') {
      const current = reciteState;
      if (current !== null && isRunning(current)) void requestVia(api, { type: 'reciteControl', reciteId: current.reciteId, action: 'stop' });
      refreshData();
    }
  }

  async function startSessionImpl(
    passageId: number,
    rung?: Rung,
    restart?: boolean,
    tier?: number,
    flow?: Flow,
  ): Promise<boolean> {
    // Optional keys are omitted entirely rather than sent as `undefined`.
    // `types.ts` requires structured-cloneable JSON, and an explicit
    // `undefined` is the one value that does not survive that trip intact -
    // it would arrive as a missing key on some paths and as `null` on others.
    const request: PanelRequest = {
      type: 'startSession',
      passageId,
      ...(rung !== undefined ? { rung } : {}),
      ...(restart ? { restart: true } : {}),
      ...(tier !== undefined ? { tier } : {}),
    };

    const reply = await requestVia(api, request);
    if (disposed) return false;
    if (!reply.ok) {
      showError(reply.error);
      return false;
    }
    const session = reply.data as RequestMap['startSession'];

    // An omitted flow means one verse (no Continue or Skip); only `startFlow`
    // passes a real one. Defaulted here so `sessionStarted` stays a plain record.
    const sessionFlow: Flow = flow ?? { kind: 'verse', passageId: session.passageId };

    justAdded = null;
    host.go({
      type: 'sessionStarted',
      sessionId: session.sessionId,
      passageId: session.passageId,
      rung: session.rung,
      flow: sessionFlow,
    });

    // `render()` deliberately leaves the practice screen alone - that view
    // owns its own DOM and its own lifetime - so the mount happens here.
    if (practice !== null) refreshData();
    practice?.destroy();
    perfScreenStart('practice');
    practice = new PracticeView(host, session, sessionFlow);
    const holder = el('div', { class: 'sm-practice-holder' });
    shell.setTab(nav.tab);
    shell.setChip(null);
    shell.setContent(holder);
    practice.mount(holder);
    perfScreenEnd('practice');
    lastPainted = nav.view;
    scrollToTop();
    announce('');
    requestSpeechRefresh();
    return true;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  async function render(): Promise<void> {
    if (disposed) return;
    const token = ++renderToken;
    const focusedNow = doc.activeElement;
    // Focus on a tab stays there (the tab bar is not rebuilt). Any other focused element is
    // remembered by id or data-passage-id, so a same-screen reload (Move to list, Rename,
    // Remove...) does not drop focus.
    const onTab = focusedNow instanceof HTMLElement && focusedNow.getAttribute('role') === 'tab' && main.contains(focusedNow);
    const hadFocus = focusedNow instanceof HTMLElement && focusedNow !== main && main.contains(focusedNow) && !onTab;
    const focusKey = hadFocus ? focusKeyOf(focusedNow as HTMLElement) : null;

    if (justAdded !== null && nav.view.name !== 'home' && nav.view.name !== 'practice' && nav.view.name !== 'recite') {
      justAdded = null;
    }

    if (practice !== null && nav.view.name !== 'practice') {
      practice.destroy();
      practice = null;
    }

    if (reciteScreen !== null && nav.view.name !== 'recite') {
      reciteScreen = null;
      reciteState = null;
    }

    // The tab bar follows the view at once, also for practice and recite (which return early below).
    shell.setTab(nav.tab);
    if (nav.view.name !== 'queue') shell.setChip(null);

    // Recite builds its screen from the core's state and then lives on pushes;
    // a planChanged push must not rebuild it mid-recitation.
    if (nav.view.name === 'recite') {
      if (reciteScreen !== null && reciteState?.reciteId === nav.view.reciteId) return;
      const reply = await host.request({ type: 'getReciteState' });
      if (disposed || token !== renderToken) return;
      if (!reply.ok || reply.data === null) {
        // Nothing to resume (finished or never started): go back.
        nav = navReduce(nav, { type: 'reciteEnded' });
        if (!reply.ok) showError(reply.error);
        void render();
        return;
      }
      mountRecite(reply.data);
      return;
    }

    // Practice mounts itself in `startSession`. Re-rendering it from here would
    // destroy a half-answered step every time a `planChanged` push arrived.
    if (nav.view.name === 'practice') return;

    const perfView = nav.view.name;
    perfScreenStart(perfView);

    // First load: an empty, aria-busy panel, then the screen.
    if (needsPlan(nav.view) && data.get() === null) {
      drawBusy();
      const failed = await data.ensure().then(
        () => null,
        (err: unknown) => (err instanceof Error ? err.message : String(err)),
      );
      if (disposed || token !== renderToken) return;
      if (failed !== null) {
        win.clearTimeout(loadingTimer);
        shell.setContent(failure(failed));
        return;
      }
    }
    win.clearTimeout(loadingTimer);
    loadingTimer = undefined;

    // Sync when the cache holds the plan: a tab switch sends no request.
    const built = buildScreen();
    const content = built instanceof Promise ? await built : built;
    if (disposed || token !== renderToken) return;

    shell.setContent(content);
    perfScreenEnd(perfView);

    // A different screen starts at its top: the scroll offset of the screen
    // just left (the host's scroller included) would otherwise carry over.
    // A refresh of the same screen keeps its place.
    const newScreen = lastPainted === null || !sameScreen(lastPainted, nav.view);
    if (newScreen) scrollToTop();
    lastPainted = nav.view;
    dayKey = startOfLocalDay(now());
    afterPaint();

    // A tab that had focus keeps it; otherwise a new screen moves focus to its
    // heading, so a keyboard or screen-reader user is not left at the top of the
    // document. `tabindex="-1"` makes it focusable without putting it in the tab order.
    if (onTab) return;
    if (newScreen) {
      focusHeading();
    } else if (hadFocus) {
      // Same screen rebuilt: put focus back on the same element, else the
      // screen heading when it would otherwise fall to <body>.
      const same = focusKey === null ? null : findByFocusKey(focusKey);
      if (same) same.focus({ preventScroll: true });
      else focusHeading();
    }
  }

  function focusKeyOf(node: HTMLElement): { attr: 'id' | 'data-passage-id'; value: string } | null {
    if (node.id) return { attr: 'id', value: node.id };
    const passage = node.getAttribute('data-passage-id') ?? node.closest('[data-passage-id]')?.getAttribute('data-passage-id');
    return passage ? { attr: 'data-passage-id', value: passage } : null;
  }

  function findByFocusKey(key: { attr: string; value: string }): HTMLElement | null {
    const hit = main.querySelector<HTMLElement>(`[${key.attr}="${key.value.replace(/"/g, '\\"')}"]`);
    if (!hit) return null;
    // A row carrying data-passage-id: focus its first focusable control.
    if (key.attr === 'data-passage-id' && !(hit instanceof HTMLButtonElement || hit instanceof HTMLAnchorElement || hit instanceof HTMLInputElement)) {
      return hit.querySelector<HTMLElement>('button, a[href], input, [tabindex]') ?? hit;
    }
    return hit;
  }

  /** The current screen's heading (its h2), else the page h1. */
  function focusHeading(): void {
    const heading = shell.panel.querySelector<HTMLElement>('h2') ?? shell.root.querySelector<HTMLElement>('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  function sendRecite(action: ReciteAction): void {
    const current = reciteState;
    if (current === null) return;
    void host.request({ type: 'reciteControl', reciteId: current.reciteId, action }).then((reply) => {
      if (!reply.ok) {
        showError(reply.error);
        return;
      }
      applyReciteState(reply.data);
    });
  }

  function retryRecite(source: { kind: 'passage'; passageId: number } | { kind: 'due' }): void {
    const current = reciteState;
    if (current === null) return;
    void startReciteRun(host, source, current.mode);
  }

  function leaveRecite(): void {
    const current = reciteState;
    // Leaving mid-run ends it, so a hands-free loop does not keep listening to nobody.
    if (current !== null && isRunning(current)) {
      void host.request({ type: 'reciteControl', reciteId: current.reciteId, action: 'stop' });
    }
    host.go({ type: 'reciteEnded' });
  }

  function mountRecite(state: ReciteStateView): void {
    reciteState = state;
    const screen =
      state.mode === 'handsfree'
        ? createHandsFreeView(state, { onControl: sendRecite, onExit: leaveRecite })
        : createReciteView(state, { onControl: sendRecite, onExit: leaveRecite, now: () => host.now(), onRetry: retryRecite });
    reciteScreen = screen;
    shell.setChip(null);
    shell.setContent(screen.element);
    requestSpeechRefresh();
  }

  function applyReciteState(state: ReciteStateView): void {
    if (disposed) return;
    if (reciteScreen !== null && nav.view.name === 'recite' && nav.view.reciteId === state.reciteId) {
      reciteState = state;
      reciteScreen.update(state);
    }
  }

  let loadingTimer: number | undefined;

  /** Views drawn from the cached plan. */
  function needsPlan(view: NavState['view']): boolean {
    return view.name !== 'card' && view.name !== 'practice' && view.name !== 'recite';
  }

  function drawBusy(): void {
    shell.setContent(null);
    win.clearTimeout(loadingTimer);
    // No spinner: a plain line, only when the load is slow.
    loadingTimer = win.setTimeout(() => {
      loadingTimer = undefined;
      const panel = shell.panel;
      if (panel.getAttribute('aria-busy') === 'true' && !disposed) {
        panel.appendChild(el('p', { class: 'sm-loading', text: tr('memory.ui.shell.loading', 'Loading...') }));
      }
    }, 400);
  }

  /** Background work a freshly drawn screen asks for. */
  function afterPaint(): void {
    const view = nav.view;
    if (!reciteEnabled()) return;
    if (view.name === 'settings') requestSpeechRefresh(true);
    else if (view.name === 'verse' || view.name === 'verses') requestSpeechRefresh();
  }

  function buildScreen(): HTMLElement | Promise<HTMLElement> {
    const view = nav.view;
    const all = data.get();
    if (needsPlan(view) && all === null) return failure(tr('memory.ui.settings.unknownScreen', 'Unknown screen.'));
    switch (view.name) {
      case 'home': {
        const focused = scopedView(all!, all!.focus ?? 'all', host.now());
        return renderHome(host, scopedView(all!, 'all', host.now()), focused, {
          startedToday: countStartedToday(all!.passages, host.now()),
          justAdded,
          reminders: focused.cardsWaiting > 0 ? { waiting: focused.cardsWaiting } : null,
        });
      }

      case 'queue': {
        const plan = scopedView(all!, all!.focus ?? 'all', host.now());
        shell.setChip(plan);
        return renderToday(host, plan, { startedToday: countStartedToday(all!.passages, host.now()) });
      }

      case 'verses':
        return renderMyVerses(host, scopedView(all!, 'all', host.now()), { list: view.list, highlight: view.highlight });

      case 'starters':
        return renderStarterBrowser(host, scopedView(all!, 'all', host.now()), { key: view.key });

      case 'verse': {
        const passageId = view.passageId;
        const draw = (pv: PassageView): HTMLElement => {
          const text = data.verseText(passageId);
          if (text === undefined && !data.verseTextFailed(passageId)) {
            // The cache's notification redraws the page when the text arrives.
            void data.loadVerseText(passageId);
          }
          return renderVersePage(host, pv, all!.lists, {
            speech: all!.speech,
            defaultAnswerMode: all!.defaultAnswerMode,
            verses: text ?? null,
            textError: data.verseTextFailed(passageId),
            backLabel: backLabel(nav.returnTo),
          });
        };
        const cached = all!.passages.find((p) => p.passage.id === passageId);
        if (cached) return draw(cached);
        // Not in the cache (just added elsewhere): ask once.
        return host.request({ type: 'getPassageView', passageId }).then((reply) => (reply.ok ? draw(reply.data) : failure(reply.error)));
      }

      case 'settings':
        return buildSettings(view.listId);

      case 'card':
        return host.request({ type: 'getCardStack' }).then((reply) => (reply.ok ? renderCardStack(host, reply.data) : failure(reply.error)));

      default:
        return failure(tr('memory.ui.settings.unknownScreen', 'Unknown screen.'));
    }
  }

  /** The verse page's Back label: the screen it goes back to. */
  function backLabel(to: NavState['view']): string {
    switch (to.name) {
      case 'home':
        return tr('memory.ui.shell.tabHome', 'Home');
      case 'queue':
        return tr('memory.ui.shell.tabPractice', 'Practice');
      case 'settings':
        return tr('memory.ui.shell.tabSettings', 'Settings');
      case 'starters':
        return tr('memory.ui.starters.title', 'Starter sets');
      default:
        return tr('memory.ui.shell.tabVerses', 'My verses');
    }
  }

  async function buildSettings(listId: number | null): Promise<HTMLElement> {
    const [settingsReply, plan, pushReply, importStatus] = await Promise.all([
      host.request({ type: 'getSettings' }),
      // All lists, from the cache: the focus only narrows Practice, and "Verses with
      // their own setting" is about every verse.
      data.ensure().then(
        (p) => ({ ok: true as const, data: p }),
        (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
      ),
      host.request({ type: 'getPushSettings' }),
      // Optional: a host without the old extension's data hides the section.
      options.api.getImportStatus().catch(() => null),
    ]);
    if (!settingsReply.ok) return failure(settingsReply.error);
    if (!plan.ok) return failure(plan.error);
    const cached = data.get() ?? plan.data;
    shownSpeech = settingsReply.data.speech ?? cached.speech;
    const all = scopedView(cached, 'all', host.now());
    return renderSettings(
      host,
      settingsReply.data,
      all,
      pushReply.ok ? pushReply.data : null,
      importStatus ? { status: importStatus, run: () => options.api.importLegacyData() } : null,
      renderLists(host, all, { listId }),
    );
  }

  /** The speech availability the Settings screen last drew (to tell a speech-only push from other changes). */
  let shownSpeech: PlanView['speech'] | null = null;

  function failure(message: string): HTMLElement {
    return el('section', { class: 'sm-screen' }, [errorBanner(message)]);
  }

  // -------------------------------------------------------------------------
  // Core pushes
  // -------------------------------------------------------------------------

  /** Opens the card stack, unless an exercise is open. */
  function showCards(): void {
    if (disposed) return;
    if (nav.view.name !== 'practice' && nav.view.name !== 'recite') {
      nav = navReduce(nav, { type: 'goCard' });
      void render();
    }
  }

  function onPush(push: MemoryPush): void {
    if (disposed) return;
    switch (push.type) {
      case 'planChanged':
        // The cache decides (same epoch and version: nothing to do) and notifies when it changed;
        // `onDataChanged` redraws, except while an exercise is open.
        data.onPlanChanged(push.epoch, push.version);
        return;

      case 'dueCountChanged':
        if (typeof push.count === 'number' && (nav.view.name === 'home' || nav.view.name === 'queue')) scheduleRender();
        return;

      case 'reciteState': {
        const state = push.state;
        if (!state || typeof state.reciteId !== 'string') return;
        if (nav.view.name === 'recite') {
          applyReciteState(state);
        } else if (nav.view.name !== 'practice' && isRunning(state)) {
          // A run started outside the panel (the "Recite what's due aloud" command): show it.
          host.go({ type: 'reciteStarted', reciteId: state.reciteId, mode: state.mode });
        }
        return;
      }

      case 'showCard':
        // A notification was clicked: open the card stack, unless an exercise is open.
        showCards();
        return;

      case 'cardsWaitingChanged':
        // Comes without a planChanged: patch the cached count (the notification redraws Home).
        data.patchCardsWaiting(push.count);
        if (nav.view.name === 'card') scheduleRender();
        return;

      case 'notice':
        announce(push.message);
        return;

      case 'status':
        // The host shows the badge.
        return;

      default:
        return;
    }
  }

  /**
   * Retargets the add-passage field's placeholder as the user reads.
   *
   * A surgical DOM poke rather than a re-render, and only when the field is
   * empty and unfocused: redrawing the plan for every verse the user scrolls
   * past would destroy a reference they were halfway through typing, and
   * changing a placeholder under an active caret is its own small rudeness.
   */
  function updateAddPlaceholder(reference: string | null): void {
    const input = container.querySelector('[id="sm-add-reference"]');
    if (!(input instanceof HTMLInputElement)) return;
    if (reference === null) return;
    if (input.value !== '' || doc.activeElement === input) return;
    input.placeholder = reference;
  }

  const unsubscribe = options.subscribe(onPush);

  /**
   * The cache changed (a refresh, a patch, text or analytics arriving): redraw, except while an exercise
   * is open. On Settings a speech-only change replaces just the banner, so a half-edited field survives.
   */
  function onDataChanged(): void {
    if (disposed || nav.view.name === 'practice') return;
    if (nav.view.name === 'settings' && shownSpeech !== null) {
      const speech = data.get()?.speech;
      if (speech !== undefined && JSON.stringify(speech) !== JSON.stringify(shownSpeech)) {
        shownSpeech = speech;
        updateSpeechBanner(main, host, speech);
      }
      // Settings is never rebuilt from a cache notification (`host.reload()` redraws it on its own).
      return;
    }
    scheduleRender();
  }
  const unsubscribeData = data.subscribe(onDataChanged);

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  // A notification click may have happened before this UI existed (the push
  // is lost), so ask the core once on open whether a card was asked for.
  function consumeLaunchIntent(): Promise<void> {
    return host.request({ type: 'consumeLaunchIntent' }).then((reply) => {
      if (disposed) return;
      if (reply.ok && reply.data.showCard && nav.view.name === 'home') {
        nav = navReduce(nav, { type: 'goCard' });
        void render();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Day rollover
  // -------------------------------------------------------------------------

  /** Redraws when the local day has changed since the last paint (never mid-exercise). */
  function checkRollover(): void {
    if (disposed) return;
    if (startOfLocalDay(now()) === dayKey) return;
    if (nav.view.name === 'practice' || nav.view.name === 'recite') return;
    void render();
  }

  function armMidnight(): void {
    win.clearTimeout(dayTimer);
    const next = new Date(now());
    next.setHours(24, 0, 0, 0);
    dayTimer = win.setTimeout(() => {
      dayTimer = undefined;
      checkRollover();
      armMidnight();
    }, Math.max(1000, next.getTime() - now() + 500));
  }

  /** Writes from outside this service send no push: re-check on wake-up. */
  function onWake(): void {
    checkRollover();
    if (!disposed) data.revalidate();
  }
  const onVisibility = (): void => {
    if (doc.visibilityState !== 'hidden') onWake();
  };
  win.addEventListener('focus', onWake);
  doc.addEventListener('visibilitychange', onVisibility);
  armMidnight();

  // -------------------------------------------------------------------------
  // Handle API
  // -------------------------------------------------------------------------

  function practiceVerse(passageId: number): void {
    if (disposed) return;
    if (nav.view.name === 'practice' || nav.view.name === 'recite') {
      announce(tr('memory.ui.shell.finishFirst', 'Finish what you are doing first.'));
      return;
    }
    void host.startSession(passageId);
  }

  function offerPractice(added: JustAdded): void {
    if (disposed) return;
    justAdded = added;
    if (nav.view.name === 'practice' || nav.view.name === 'recite') return; // shown when Home comes back
    if (nav.view.name !== 'home') nav = navReduce(nav, { type: 'goTab', tab: 'home' });
    void render();
  }

  // On open, resume a run that is already going (hands-free started by the
  // command), else show Home - or the card stack when asked to.
  if (options.initialView === 'card') nav = navReduce(nav, { type: 'goCard' });
  // Reopened: the cached plan draws at once and refreshes in the background. First open: the load
  // starts now, in parallel with getReciteState, and the shell is drawn before it lands.
  if (cachedAtMount) data.revalidate();
  else if (options.initialView !== 'card') data.ensure().catch(() => undefined);
  // The shell is drawn at once; a getReciteState that never answers (a request lost at boot) must not
  // leave the stage blank, so the first paint waits at most ~1.5 s for it and re-renders when it lands.
  if (needsPlan(nav.view) && data.get() === null && options.initialView !== 'card') drawBusy();
  let reciteTimedOut = false;
  const reciteReply = host.request({ type: 'getReciteState' }).then((reply) => {
    if (reply.ok && reply.data !== null && isRunning(reply.data) && options.initialView !== 'card') {
      nav = navReduce(nav, { type: 'reciteStarted', reciteId: reply.data.reciteId, mode: reply.data.mode });
      if (reciteTimedOut && !disposed) void render();
    }
  });
  let reciteTimer: number | undefined;
  void Promise.race([
    reciteReply.finally(() => win.clearTimeout(reciteTimer)),
    new Promise<void>((resolve) => {
      reciteTimer = win.setTimeout(() => {
        reciteTimedOut = true;
        resolve();
      }, 1500);
    }),
  ])
    .catch(() => undefined)
    .then(async () => {
      const first = options.initialPractice;
      if (first !== undefined && nav.view.name === 'home') {
        await host.startSession(first);
        if ((nav as NavState).view.name === 'practice') return;
      }
      await render();
    })
    .then(() => consumeLaunchIntent())
    .catch(() => undefined);

  return {
    dispose(): void {
      if (disposed) return;
      stopLongTasks();
      unsubscribe();
      unsubscribeData();
      win.clearTimeout(loadingTimer);
      loadingTimer = undefined;
      win.clearTimeout(reciteTimer);
      practice?.destroy();
      practice = null;
      reciteScreen = null;
      reciteState = null;
      win.clearTimeout(statusTimer);
      statusTimer = undefined;
      win.clearTimeout(dayTimer);
      dayTimer = undefined;
      win.removeEventListener('focus', onWake);
      doc.removeEventListener('visibilitychange', onVisibility);
      renderToken++;
      disposed = true;
      clear(container);
      container.classList.remove('sm-app');
    },
    showCards,
    setActiveReference(reference: string | null): void {
      if (disposed) return;
      activeReference = reference;
      updateAddPlaceholder(reference);
    },
    practice: practiceVerse,
    offerPractice,
  };
}
