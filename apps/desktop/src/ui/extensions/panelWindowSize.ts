/**
 * A contributed panel type's preferred pop-out window size.
 *
 * Every extension panel used to detach at exactly 900x700, because
 * `paneConfig.ts` has ONE `extension` entry covering every contributed panel
 * and that entry owns the size. That is fine for the built-ins - a Commentary
 * window is a Commentary window - and wrong here: a verse-timeline strip and a
 * full study workbench are both `extension`, and the host has no way to tell
 * them apart. Only the extension knows.
 *
 * The value rides on the panel type definition, so it is declared once at
 * `ui.registerPanelType` (or in the manifest's `contributes.panelTypes`) and
 * needs no separate call. It travels to the renderer untouched: the def is
 * forwarded wholesale by `RendererUiBridge.registerPanelType` and stored
 * wholesale by `extensionUiStore.addPanelType`, so no layer in between
 * enumerates its fields.
 *
 * ## Where the field is declared
 *
 * `defaultWindowSize` is declared on `ExtensionPanelTypeDef` in
 * `packages/core/src/Extensions/ExtensionApiDtos.ts`, next to `defaultBucket`
 * and `writingPane`, so authors get completion and a compile-time check on
 * the object literal they pass to `ui.registerPanelType`.
 *
 * ## What this module does NOT do
 *
 * It does not clamp. The renderer is not the trust boundary - the main process
 * is, and `resolveDetachedWindowSize()` in `electron/config/paneConfig.ts`
 * does the clamping there, where it also has the pane's `minWidth`/`minHeight`
 * and cannot be bypassed by anything that reaches the IPC channel directly.
 * This side only decides whether there is a request worth forwarding at all.
 */

/**
 * The slice of a panel type definition this module reads, with both dimensions
 * widened to `unknown`.
 *
 * Deliberately looser than `ExtensionPanelTypeDef.defaultWindowSize`, which
 * types them as numbers. That declaration constrains what an author can
 * *write*; it says nothing about what actually arrives. The def crosses an RPC
 * boundary from a sandboxed worker, so by the time it reaches here it is
 * parsed JSON that a compiler never saw - a string, a NaN or a nested object
 * are all reachable at runtime. Validating against the narrower type would
 * mean trusting the wire.
 */
interface PanelTypeWithWindowSize {
  defaultWindowSize?: {
    width?: unknown;
    height?: unknown;
  };
}

/** A size request on its way to the main process. Neither field is validated. */
export interface PanelWindowSizeRequest {
  width?: number;
  height?: number;
}

/**
 * Read the panel type's declared pop-out size, or `undefined` when it declared
 * none.
 *
 * Returns `undefined` rather than the pane config's defaults so that "declared
 * nothing" and "declared 900x700" stay distinguishable at the IPC boundary -
 * the main process substitutes the defaults, and it should not have to guess
 * whether it is looking at a real preference.
 *
 * Width and height are carried independently: a panel that names only a width
 * gets its width honoured and keeps the default height. Non-numeric junk is
 * dropped here as well as clamped in the main process, so a malformed
 * declaration never widens the payload.
 */
export function declaredPanelWindowSize(def: unknown): PanelWindowSizeRequest | undefined {
  if (typeof def !== 'object' || def === null) return undefined;
  const declared = (def as PanelTypeWithWindowSize).defaultWindowSize;
  if (typeof declared !== 'object' || declared === null) return undefined;

  const request: PanelWindowSizeRequest = {};
  if (typeof declared.width === 'number' && Number.isFinite(declared.width)) {
    request.width = declared.width;
  }
  if (typeof declared.height === 'number' && Number.isFinite(declared.height)) {
    request.height = declared.height;
  }

  return request.width === undefined && request.height === undefined ? undefined : request;
}
