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
import type { PanelReply, PanelRequest, ReciteAction, ReciteStateView, RequestMap, Rung } from '../core/types';
import { clear, el } from './dom';
import { errorBanner } from './components';
import type { PanelHost } from './host';
import { WordMeasurer } from './measure';
import { PracticeView } from './practiceView';
import { renderPlan } from './planView';
import { renderAnalytics } from './analyticsView';
import { renderPassageScreen } from './passageView';
import { renderManagePassages } from './managePassagesView';
import { renderSettings } from './settingsView';
import { createReciteView } from './reciteView';
import { createHandsFreeView } from './handsFreeView';
import { startReciteRun } from './activities';
import { renderCardStack } from './cardView';
import { pickFlowTarget } from './suggest';
import { INITIAL_NAV, navReduce, sameView } from './state';
import type { Flow, NavAction, NavState } from './state';
import { setUiTranslator } from './i18n';
import type { Translate } from './i18n';
import './memory.css';

export interface MemoryUiOptions {
  /** The core (desktop: IPC client; tests: a fake). */
  api: MemoryApi;
  /** Core pushes. Returns the unsubscribe function. */
  subscribe(listener: (push: MemoryPush) => void): () => void;
  /** 'card' = open the push-card stack first (notification click). */
  initialView?: 'plan' | 'card';
  /** The reader's current reference, for the add field placeholder. */
  activeReference?: string | null;
  /** Clock; default `Date.now`. */
  now?(): number;
  /** The host's translator (catalog lookup); default: the built-in English. */
  t?: Translate;
  /** BCP-47 tag for dates and numbers; default: the runtime's. */
  locale?: string;
}

export interface MemoryUiHandle {
  /** Unsubscribe, destroy the practice view, clear timers, empty the container. */
  dispose(): void;
  /** Same as a `showCard` push. */
  showCards(): void;
  /** Replaces the old `activeVerse` push. */
  setActiveReference(reference: string | null): void;
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
  }
}

function isRunning(state: ReciteStateView): boolean {
  return state.phase !== 'summary' && state.phase !== 'done' && state.phase !== 'error';
}

export function mountMemoryUi(container: HTMLElement, options: MemoryUiOptions): MemoryUiHandle {
  const { api } = options;
  setUiTranslator(options.t, options.locale);
  const now = options.now ?? (() => Date.now());
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;

  container.classList.add('sm-app');
  clear(container);
  const main = el('main', { class: 'sm-main' });
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

  const measurer = new WordMeasurer(doc);

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

  const host: PanelHost = {
    now,

    request<R extends PanelRequest>(request: R): Promise<PanelReply<RequestMap[R['type']]>> {
      return requestVia(api, request);
    },

    go(action: NavAction): void {
      const next = navReduce(nav, action);
      const changed = !sameView(next.view, nav.view) || !sameView(next.returnTo, nav.returnTo);
      nav = next;
      if (changed) void render();
    },

    reload(): void {
      void render();
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
      if (disposed) return;
      if (!reply.ok) {
        showError(reply.error);
        return;
      }
      const session = reply.data as RequestMap['startSession'];

      // Every direct call site names one specific passage the user was already
      // looking at, so an omitted flow means `passage`; only `startFlow` passes
      // a real one. Defaulted here so `sessionStarted` stays a plain record.
      const sessionFlow: Flow = flow ?? { kind: 'passage', passageId: session.passageId };

      host.go({
        type: 'sessionStarted',
        sessionId: session.sessionId,
        passageId: session.passageId,
        rung: session.rung,
        flow: sessionFlow,
      });

      // `render()` deliberately leaves the practice screen alone - that view
      // owns its own DOM and its own lifetime - so the mount happens here.
      practice?.destroy();
      clear(main);
      practice = new PracticeView(host, session, sessionFlow);
      practice.mount(main);
      announce('');
    },

    async startFlow(flow: Flow, exclude?: ReadonlySet<number>): Promise<void> {
      const reply = await host.request({ type: 'getPlan' });
      if (!reply.ok) {
        showError(reply.error);
        return;
      }
      const target = pickFlowTarget(reply.data, flow, host.now(), Math.random, exclude);
      if (!target) {
        announce('Nothing else to practice right now.');
        return;
      }
      await host.startSession(target.passageId, target.rung, undefined, undefined, flow);
    },

    openInBible(verseId: number): void {
      void requestVia(api, { type: 'navigateTo', verseId }).then((reply) => {
        if (!reply.ok) showError(reply.error);
      });
    },

    announce,
  };

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  async function render(): Promise<void> {
    if (disposed) return;
    const token = ++renderToken;

    if (practice !== null && nav.view.name !== 'practice') {
      practice.destroy();
      practice = null;
    }

    if (reciteScreen !== null && nav.view.name !== 'recite') {
      reciteScreen = null;
      reciteState = null;
    }

    // Recite builds its screen from the core's state and then lives on pushes;
    // a planChanged push must not rebuild it mid-recitation.
    if (nav.view.name === 'recite') {
      if (reciteScreen !== null && reciteState?.reciteId === nav.view.reciteId) return;
      const reply = await host.request({ type: 'getReciteState' });
      if (disposed || token !== renderToken) return;
      if (!reply.ok || reply.data === null) {
        // Nothing to resume (finished or never started): go home.
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

    const content = await buildScreen();
    if (disposed || token !== renderToken) return;

    clear(main);
    main.appendChild(content);

    // Move focus to the new screen's heading, so a keyboard or screen-reader
    // user is not left at the top of the document after every navigation.
    // `tabindex="-1"` makes it focusable without putting it in the tab order.
    const heading = main.querySelector<HTMLElement>('h1');
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
    clear(main);
    main.appendChild(screen.element);
  }

  function applyReciteState(state: ReciteStateView): void {
    if (disposed) return;
    if (reciteScreen !== null && nav.view.name === 'recite' && nav.view.reciteId === state.reciteId) {
      reciteState = state;
      reciteScreen.update(state);
    }
  }

  async function buildScreen(): Promise<HTMLElement> {
    switch (nav.view.name) {
      case 'plan': {
        const reply = await host.request({ type: 'getPlan' });
        return reply.ok ? renderPlan(host, reply.data) : failure(reply.error);
      }

      case 'passage': {
        // `getPassageView` does not return `defaultAnswerMode`, which
        // `getPlan` used to carry along for free; `getSettings` is fetched
        // alongside for it.
        const passageId = nav.view.passageId;
        const [passageReply, settingsReply] = await Promise.all([
          host.request({ type: 'getPassageView', passageId }),
          host.request({ type: 'getSettings' }),
        ]);
        if (!passageReply.ok) {
          // Removed elsewhere between the click and the fetch reads the same as
          // any other failure to the core, but this one has a specific,
          // friendlier story: fall back to the plan rather than an error banner.
          announce('That passage is no longer in your plan.');
          nav = navReduce(nav, { type: 'passageRemoved', passageId });
          const planReply = await host.request({ type: 'getPlan' });
          return planReply.ok ? renderPlan(host, planReply.data) : failure(planReply.error);
        }
        if (!settingsReply.ok) return failure(settingsReply.error);
        return renderPassageScreen(
          host,
          passageReply.data,
          settingsReply.data.defaultAnswerMode,
          nav.view.rung,
          settingsReply.data.speech,
        );
      }

      case 'analytics': {
        const reply = await host.request({ type: 'getAnalytics' });
        return reply.ok ? renderAnalytics(host, reply.data) : failure(reply.error);
      }

      case 'settings': {
        const [settingsReply, planReply, pushReply, importStatus] = await Promise.all([
          host.request({ type: 'getSettings' }),
          host.request({ type: 'getPlan' }),
          host.request({ type: 'getPushSettings' }),
          // Optional: a host without the old extension's data hides the section.
          options.api.getImportStatus().catch(() => null),
        ]);
        if (!settingsReply.ok) return failure(settingsReply.error);
        if (!planReply.ok) return failure(planReply.error);
        return renderSettings(
          host,
          settingsReply.data,
          planReply.data,
          pushReply.ok ? pushReply.data : null,
          importStatus ? { status: importStatus, run: () => options.api.importLegacyData() } : null,
        );
      }

      case 'card': {
        const reply = await host.request({ type: 'getCardStack' });
        return reply.ok ? renderCardStack(host, reply.data) : failure(reply.error);
      }

      case 'managePassages': {
        const reply = await host.request({ type: 'getPlan' });
        return reply.ok ? renderManagePassages(host, reply.data) : failure(reply.error);
      }

      default:
        return failure('Unknown screen.');
    }
  }

  function failure(message: string): HTMLElement {
    return el('section', { class: 'sm-screen' }, [
      el('h1', { class: 'sm-screen-title', text: 'Scripture Memory' }),
      errorBanner(message),
    ]);
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
        // Not while an exercise is open. A push is a hint that something changed
        // elsewhere; it is not worth throwing away a half-typed verse for.
        if (nav.view.name !== 'practice') void render();
        return;

      case 'dueCountChanged':
        if (typeof push.count === 'number' && nav.view.name === 'plan') void render();
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
        if (nav.view.name === 'plan' || nav.view.name === 'card') void render();
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

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  // A notification click may have happened before this UI existed (the push
  // is lost), so ask the core once on open whether a card was asked for.
  function consumeLaunchIntent(): Promise<void> {
    return host.request({ type: 'consumeLaunchIntent' }).then((reply) => {
      if (disposed) return;
      if (reply.ok && reply.data.showCard && nav.view.name === 'plan') {
        nav = navReduce(nav, { type: 'goCard' });
        void render();
      }
    });
  }

  // On open, resume a run that is already going (hands-free started by the
  // command), else show the plan - or the card stack when asked to.
  if (options.initialView === 'card') nav = navReduce(nav, { type: 'goCard' });
  void host
    .request({ type: 'getReciteState' })
    .then((reply) => {
      if (reply.ok && reply.data !== null && isRunning(reply.data) && options.initialView !== 'card') {
        nav = navReduce(nav, { type: 'reciteStarted', reciteId: reply.data.reciteId, mode: reply.data.mode });
      }
    })
    .catch(() => undefined)
    .then(() => render())
    .then(() => consumeLaunchIntent())
    .catch(() => undefined);

  return {
    dispose(): void {
      if (disposed) return;
      unsubscribe();
      practice?.destroy();
      practice = null;
      reciteScreen = null;
      reciteState = null;
      win.clearTimeout(statusTimer);
      statusTimer = undefined;
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
  };
}
