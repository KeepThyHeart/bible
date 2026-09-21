/**
 * BibleExtUI — main entry point for the Extension UI SDK.
 *
 * Extension iframes call `BibleExtUI.init()` to get a typed bridge to the
 * host app. All communication goes through `postMessage` with origin
 * validation on the host side.
 *
 * ```html
 * <script src="ext-ui://sdk/bible-ext-ui.js"></script>
 * <script>
 *   const bible = BibleExtUI.init();
 *   bible.linkVerses(document.body);
 *   bible.navigateToVerse(43003016); // John 3:16
 * </script>
 * ```
 */

import { RpcClient, type Disposable } from './RpcClient';
import { scanText, parseReference, calculateVerseId, type ScannedRef } from './verseParser';

// ── Public types ─────────────────────────────────────────────────────────

export interface ThemeInfo {
  mode: 'light' | 'dark' | 'sepia';
  /** CSS custom property values the extension can use for consistent styling. */
  colors?: Record<string, string>;
}

export interface LinkVersesOptions {
  /**
   * CSS class added to generated verse links. Default: `'bible-verse-link'`.
   */
  className?: string;
  /**
   * If true, hovering a link requests a verse popup from the host.
   * Default: true.
   */
  popup?: boolean;
  /**
   * If true, clicking a link navigates the host Bible pane.
   * Default: true.
   */
  navigate?: boolean;
}

export interface BibleExtUIOptions {
  /** RPC timeout in ms. Default 10 000. */
  timeoutMs?: number;
}

/** Options for {@link BibleExtUI.fetch}. Mirrors the worker-side `api.network.fetch`. */
export interface UiFetchInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | { json: unknown } | { form: Record<string, string> };
  /** `'text'` (default), `'json'`, or `'arrayBuffer'`. */
  responseType?: 'text' | 'json' | 'arrayBuffer';
  timeoutMs?: number;
  maxResponseBytes?: number;
  redirect?: 'follow' | 'error' | 'manual';
}

/** Result of {@link BibleExtUI.fetch}. */
export interface UiFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  body: unknown;
}

// ── SDK class ────────────────────────────────────────────────────────────

export class BibleExtUI {
  private readonly rpc: RpcClient;

  private constructor(rpc: RpcClient) {
    this.rpc = rpc;
  }

  /**
   * Initialise the SDK bridge to the host app.
   * Call once at iframe load time.
   */
  static init(opts?: BibleExtUIOptions): BibleExtUI {
    const rpc = new RpcClient({ timeoutMs: opts?.timeoutMs });
    return new BibleExtUI(rpc);
  }

  // ── Navigation ───────────────────────────────────────────────────────

  /**
   * Navigate the host's Bible pane to a verse by numeric verse ID.
   *
   * Verse ID = (book * 1_000_000) + (chapter * 1_000) + verse.
   * Example: John 3:16 = 43_003_016.
   */
  navigateToVerse(verseId: number): Promise<void> {
    return this.rpc.request('bible.navigateToVerse', [verseId]);
  }

  /**
   * Navigate the host's Bible pane to a verse by reference string.
   * Parses the reference locally, then delegates to `navigateToVerse`.
   *
   * @throws If the reference cannot be parsed.
   */
  async navigateToReference(ref: string): Promise<void> {
    const parsed = parseReference(ref);
    if (!parsed) throw new Error(`Cannot parse reference: ${ref}`);
    return this.navigateToVerse(parsed.verseId);
  }

  // ── Verse popups ─────────────────────────────────────────────────────

  /**
   * Request the host to show a verse popup anchored to an element.
   *
   * The host decides whether to honour the request based on the
   * extension's permissions and the current UI state.
   */
  showVersePopup(verseId: number, rect: { x: number; y: number; width: number; height: number }): void {
    // Fire-and-forget — popup display is host-managed.
    this.rpc.request('ui.showVersePopup', [verseId, rect]).catch(() => {
      // Best-effort; host may not support popups yet.
    });
  }

  /**
   * Ask the host to hide any currently-shown verse popup.
   */
  hideVersePopup(): void {
    this.rpc.request('ui.hideVersePopup', []).catch(() => {});
  }

  // ── Events from host ─────────────────────────────────────────────────

  /**
   * Subscribe to active-verse changes in the host Bible pane.
   */
  onActiveVerseChanged(callback: (verseId: number) => void): Disposable {
    return this.rpc.on('verse.activeChanged', (payload) => {
      if (typeof payload === 'number') callback(payload);
    });
  }

  /**
   * Subscribe to theme changes in the host app.
   */
  onThemeChanged(callback: (theme: ThemeInfo) => void): Disposable {
    return this.rpc.on('theme.changed', (payload) => {
      callback(payload as ThemeInfo);
    });
  }

  // ── Theme ────────────────────────────────────────────────────────────

  /**
   * Get the current host theme.
   */
  getTheme(): Promise<ThemeInfo> {
    return this.rpc.request<ThemeInfo>('ui.getTheme', []);
  }

  // ── Verse linking ────────────────────────────────────────────────────

  /**
   * Scan a DOM container for Bible references and wrap them in
   * clickable `<a>` elements.
   *
   * - Click → navigate the host Bible pane to that verse.
   * - Hover → show a verse popup (if `popup` option is true).
   *
   * Only scans `Text` nodes, so existing HTML structure is preserved.
   * Can be called multiple times on the same container (already-linked
   * nodes are skipped).
   */
  linkVerses(
    container: HTMLElement,
    opts?: LinkVersesOptions,
  ): void {
    const className = opts?.className ?? 'bible-verse-link';
    const doPopup = opts?.popup !== false;
    const doNavigate = opts?.navigate !== false;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode()) !== null) {
      // Skip nodes inside already-linked anchors.
      if ((node.parentElement as HTMLElement | null)?.classList?.contains(className)) continue;
      textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      const refs = scanText(text);
      if (refs.length === 0) continue;

      const frag = document.createDocumentFragment();
      let cursor = 0;

      for (const ref of refs) {
        // Text before this match.
        if (ref.start > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, ref.start)));
        }

        const anchor = this.createVerseAnchor(ref, className, doNavigate, doPopup);
        frag.appendChild(anchor);
        cursor = ref.end;
      }

      // Remaining text after the last match.
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }

      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  // ── Network ──────────────────────────────────────────────────────────

  /**
   * Perform an outbound HTTP request from panel UI code.
   *
   * **Use this instead of the global `fetch()`.** A panel iframe's Content
   * Security Policy lists no remote host, so a direct `fetch()` to anything
   * off-origin is blocked by the browser. Requests made here are handed to
   * the host and run through your extension's own network pipeline, which
   * means they are subject to exactly the same rules as
   * `api.network.fetch()` from your worker code:
   *
   *   - the host must appear in your manifest's `network.allowedHosts`;
   *   - the per-extension request throttle and bandwidth cap apply, and the
   *     two paths share one budget;
   *   - redirects are re-validated against the allowlist at every hop;
   *   - the user's master offline switch turns this off with everything else.
   *
   * Requires the `network` permission. Rejects if the extension is not
   * active or never declared it.
   *
   * ```typescript
   * const res = await bible.fetch('https://api.example.com/lexicon?w=logos', {
   *   responseType: 'json',
   * });
   * if (res.ok) console.log(res.body);
   * ```
   */
  fetch(url: string, init?: UiFetchInit): Promise<UiFetchResponse> {
    return this.rpc.request<UiFetchResponse>('network.fetch', [url, init]);
  }

  // ── Talking to your extension's worker ───────────────────────────────

  /**
   * Send a message to your extension's worker and await its reply.
   *
   * **This is how panel UI reaches the API.** A panel iframe runs on its own
   * sandboxed origin and can only navigate a verse, read the theme, and make
   * a permission-gated {@link fetch}. It cannot call `api.storage`,
   * `api.bible` or `api.l10n` directly - those live in your worker, behind the
   * permission guard. So the panel asks, and the worker answers:
   *
   * ```typescript
   * // worker (main.js)
   * api.panels.onMessage(async (msg) => {
   *   if (msg.type === 'load') return api.storage.get('state');
   *   throw new Error(`unknown request: ${msg.type}`);
   * });
   * ```
   * ```typescript
   * // panel
   * const state = await bible.postToWorker({ type: 'load' });
   * ```
   *
   * The host stamps your extension's identity onto the message from the
   * closure that mounted this iframe, so the worker always knows which of its
   * panels asked and no other extension can be addressed.
   *
   * Rejects if your extension is not active, has not registered a handler,
   * the handler threw, the message exceeds 256 KB of JSON, or the worker took
   * longer than 10 seconds to answer.
   */
  postToWorker<T = unknown>(message: unknown): Promise<T> {
    return this.rpc.request<T>('panel.invoke', [message]);
  }

  /**
   * Receive messages your worker pushed with `api.panels.postMessage(...)`.
   *
   * These arrive without being asked for, so treat them as notifications - a
   * refresh signal, a progress tick, a "your data changed elsewhere" nudge.
   * A panel that is closed or still loading misses them, so anything the
   * panel must not miss belongs in storage it reads on mount instead.
   */
  onWorkerMessage(callback: (message: unknown) => void): Disposable {
    return this.rpc.on('panel.message', (payload) => {
      callback(payload);
    });
  }

  // ── Utility ──────────────────────────────────────────────────────────

  /**
   * Parse a verse reference string. Convenience re-export of the parser.
   */
  parseReference(ref: string) {
    return parseReference(ref);
  }

  /**
   * Calculate a verse ID from components.
   */
  calculateVerseId(book: number, chapter: number, verse: number): number {
    return calculateVerseId(book, chapter, verse);
  }

  /**
   * Dispose the SDK — closes the RPC client and cleans up event listeners.
   */
  dispose(): void {
    this.rpc.dispose();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private createVerseAnchor(
    ref: ScannedRef,
    className: string,
    navigate: boolean,
    popup: boolean,
  ): HTMLAnchorElement {
    const a = document.createElement('a');
    a.className = className;
    a.textContent = ref.text;
    a.href = '#';
    a.dataset.verseId = String(ref.verseId);
    if (ref.endVerseId) a.dataset.endVerseId = String(ref.endVerseId);

    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (navigate) {
        this.navigateToVerse(ref.verseId).catch(() => {});
      }
    });

    if (popup) {
      a.addEventListener('mouseenter', () => {
        const rect = a.getBoundingClientRect();
        this.showVersePopup(ref.verseId, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
      });
      a.addEventListener('mouseleave', () => {
        this.hideVersePopup();
      });
    }

    return a;
  }
}
