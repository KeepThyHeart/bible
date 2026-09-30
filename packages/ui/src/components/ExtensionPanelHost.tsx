/**
 * ExtensionPanelHost: renders one sandboxed extension-panel iframe and owns its `IframeRpcBridge`.
 *
 * The bridge (transport, source check, envelope validation, deny-by-default `uikit.*` allowlist, error
 * mapping) lives in `@bible/core/browser`. This component is the React half: it mounts the iframe with the
 * `sandbox` the caller computed and `referrerPolicy="no-referrer"`, creates ONE bridge per mounted host,
 * attaches it to `window`, and disposes it on unmount. What is host-specific stays with the caller: the handler
 * map (desktop IPC, web later), the host-assembled `context` (identity and grants, never from the iframe), extra
 * `authorize` policy, host to panel pushes (through `onBridge`, then `bridge.emit`), and the error/loading UI.
 *
 * The bridge reads the iframe lazily (message and send time), so it attaches while `src` is still `null`
 * (loading) and stays attached across the iframe mounting.
 *
 * `handlers` is captured when the bridge is created: keep it referentially stable (`useMemo`); a new object
 * disposes the bridge and creates another (`onBridge(null)` then `onBridge(next)`). `context` and `authorize`
 * are read through refs, so inline values are fine and do not recreate the bridge.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode, Ref } from 'react';
import { IframeRpcBridge } from '@bible/core/browser';
import type { BridgeContext, BridgeHandlers, IframeRpcBridgeOptions } from '@bible/core/browser';

export interface ExtensionPanelHostProps {
  /** The panel URL; `null` renders `loading` and no iframe. */
  src: string | null;
  /** The `sandbox` attribute, computed by the caller (it decides `allow-*` tokens; never `allow-same-origin`). */
  sandbox: string;
  title: string;
  /** Host-assembled identity, manifest and grants. A getter is read once per request (grants arrive async). */
  context: BridgeContext | (() => BridgeContext);
  /** The host's method map. Keep it stable (see the file comment). */
  handlers: BridgeHandlers;
  /** Extra host policy, after the built-in `uikit.*` check. */
  authorize?: IframeRpcBridgeOptions['authorize'];
  /** Called with the live bridge after it attaches, and with `null` after it is disposed (wire `emit` pushes here). */
  onBridge?: (bridge: IframeRpcBridge | null) => void;
  /** When set, replaces the iframe with this message (`role="alert"`). */
  error?: string | null;
  /** Shown while `src` is `null`. */
  loading?: ReactNode;
  /** Extra class on the iframe (and the status box), after `kth-panel-host__frame`/`__status`. */
  className?: string;
  /** `data-*` attributes for the iframe and the status box (for example `data-panel-id`). */
  dataAttributes?: Record<`data-${string}`, string>;
  /** Gives the caller the iframe element (for example to translate iframe coordinates to page coordinates). */
  iframeRef?: Ref<HTMLIFrameElement>;
}

export function ExtensionPanelHost({
  src,
  sandbox,
  title,
  context,
  handlers,
  authorize,
  onBridge,
  error,
  loading,
  className,
  dataAttributes,
  iframeRef,
}: ExtensionPanelHostProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;
  const authorizeRef = useRef(authorize);
  authorizeRef.current = authorize;
  const onBridgeRef = useRef(onBridge);
  onBridgeRef.current = onBridge;

  useEffect(() => {
    const bridge = new IframeRpcBridge({
      context: () => {
        const c = contextRef.current;
        return typeof c === 'function' ? c() : c;
      },
      handlers,
      hostWindow: window,
      getTarget: () => frameRef.current?.contentWindow,
      authorize: (method, ctx) => authorizeRef.current?.(method, ctx) ?? { ok: true },
    });
    bridge.attach();
    onBridgeRef.current?.(bridge);
    return () => {
      bridge.dispose();
      onBridgeRef.current?.(null);
    };
  }, [handlers]);

  const setFrame = useCallback(
    (el: HTMLIFrameElement | null) => {
      frameRef.current = el;
      if (typeof iframeRef === 'function') iframeRef(el);
      else if (iframeRef) (iframeRef as { current: HTMLIFrameElement | null }).current = el;
    },
    [iframeRef],
  );

  const classes = (base: string) => (className ? `${base} ${className}` : base);

  if (error) {
    return (
      <div className={classes('kth-panel-host__status')} role="alert" {...dataAttributes}>
        <span>{error}</span>
      </div>
    );
  }

  if (src === null) {
    return (
      <div className={classes('kth-panel-host__status')} {...dataAttributes}>
        {loading}
      </div>
    );
  }

  return (
    <iframe
      ref={setFrame}
      title={title}
      src={src}
      sandbox={sandbox}
      referrerPolicy="no-referrer"
      className={classes('kth-panel-host__frame')}
      {...dataAttributes}
    />
  );
}
