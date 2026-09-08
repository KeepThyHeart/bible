/**
 * QuickJS realm host.
 *
 * Runs one extension's code inside a QuickJS interpreter compiled to WASM.
 * This file is the entire boundary between the host and untrusted extension
 * code: everything the guest can reach is injected here, so the list of
 * `ctx.setProp(ctx.global, ...)` calls below is an exhaustive statement of the
 * extension's ambient authority. It is currently four functions, none of which
 * touch the filesystem, the network, or another extension.
 *
 * -- Why this and not a Node worker ------------------------------------------
 * The realm sits *inside* the existing per-extension `utilityProcess`, which
 * keeps the OS process as an outer ring the host can still hard-kill. That
 * layering is deliberate:
 *
 *   - The utilityProcess bounds what a QuickJS or WASM bug could reach if the
 *     interpreter itself were compromised.
 *   - The realm bounds what *correctly working* extension code can reach,
 *     which is the actual threat: in a plain Node worker, `require('fs')`
 *     simply works.
 *
 * Keeping the process also means the transport, the heartbeat and
 * `ExtensionRpcRouter` are untouched: the supervisor still speaks the same
 * protocol on `parentPort`, it just no longer runs extension code in Node.
 *
 * -- On `eval` staying enabled -----------------------------------------------
 * The realm keeps QuickJS's `Eval` intrinsic, so guest code can reach `eval`
 * and `Function`. This is not an oversight and it cannot be closed halfway:
 * disabling the intrinsic also disables the host's own `evalCode`, which is
 * how the extension bundle is loaded in the first place, and deleting the
 * `Function` global achieves nothing while `(function(){}).constructor`
 * exists. It is also not worth closing. Code generation confers no authority:
 * a function the guest synthesises runs in the same realm, against the same
 * empty global object, as the code that synthesised it. What matters is that
 * the realm has nothing worth reaching, and that is enforced here.
 *
 * -- Liveness ----------------------------------------------------------------
 * Every entry into guest code goes through `enterGuest`, which arms an
 * interrupt deadline first. A guest that spins is interrupted with an
 * exception rather than wedging the supervisor, so the process - and the
 * heartbeat that keeps it alive - stays responsive. The outer `SIGKILL`
 * remains, but it is now a backstop rather than the only defence.
 */

import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';

import { decodeEnvelope, encodeEnvelope } from '../binaryCodec';

/**
 * Ceiling on how far the realm's heap may grow beyond its baseline.
 *
 * -- Why this is NOT enforced with QuickJS's own memory limit ----------------
 * `JS_SetMemoryLimit` does not work in these builds, and it fails *open*. It
 * accounts for allocations using `malloc_usable_size()`, which the emscripten
 * builds do not provide - `dumpMemoryUsage()` says so outright:
 * "malloc_usable_size unavailable". Measured: with an 8 MB limit configured, a
 * loop pushing `new Array(10000)` reached **1.66 GB** before anything stopped
 * it, and lowering the limit to 1 MB changed nothing. quickjs-ng has the same
 * gap, so switching engines is not a fix. A limit that silently permits 200x
 * its own value is worse than none, because the code reads as though the
 * extension were bounded.
 *
 * -- Why not the interrupt handler either ------------------------------------
 * Sampling heap size from the interrupt handler was the obvious next idea and
 * it is not sufficient on its own. QuickJS polls interrupts per *bytecode op*,
 * not per allocation, and a single op can allocate arbitrarily much: the loop
 * above got only **2 interrupt polls** across 240 MB of growth, and
 * `new Array(100000000)` allocates ~800 MB in one op that is never interrupted
 * at all.
 *
 * -- What actually enforces it -----------------------------------------------
 * The realm's `WebAssembly.Memory` is created with an explicit `maximum`, so
 * the bound is enforced by the WebAssembly engine itself. Growth past it fails,
 * `malloc` returns null, and QuickJS raises a clean `out of memory`. It is
 * exact and needs no polling: measured, a 32 MB ceiling stops the loop at
 * 31 MB in 47 ms, and stops the single giant allocation too.
 *
 * The interrupt handler still watches memory, but only to interrupt *early*, at
 * `MEMORY_PRESSURE_FRACTION` of the ceiling. That is not the bound - it is a
 * way to unwind cleanly before QuickJS hits a real OOM, whose unwind path leaks
 * a context reference (see `dispose`).
 *
 * Because WASM memory only ever grows, the ceiling is a *high-water* mark:
 * memory freed inside the realm does not lower it. That errs in the safe
 * direction, and the default is far above what any real extension needs.
 */
export const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;

/** WebAssembly page size. Memory `initial`/`maximum` are counted in these. */
const WASM_PAGE_BYTES = 65536;

/**
 * Initial heap the emscripten build expects, in pages (16 MB). The realm's
 * ceiling is applied on top of this, so `memoryLimitBytes` means "growth the
 * extension may cause", not "total including the interpreter's own baseline".
 */
const WASM_INITIAL_PAGES = 256;

/**
 * Interrupt the guest once it has consumed this much of its ceiling, rather
 * than waiting for the hard cap to produce a real out-of-memory. Polling is too
 * coarse to rely on (see above), so this is opportunistic: when it does fire
 * first, teardown stays on the clean path.
 */
const MEMORY_PRESSURE_FRACTION = 0.9;

/**
 * Default ceiling on native stack depth. QuickJS's own default is ~256 KB;
 * we keep it, but state it explicitly so a runaway recursion becomes a guest
 * `InternalError` rather than a WASM trap that takes the supervisor with it.
 */
export const DEFAULT_MAX_STACK_BYTES = 256 * 1024;

/**
 * How long one uninterrupted guest turn may run. A turn is a single host->guest
 * call plus the microtasks it drains, not the extension's whole lifetime, so
 * this is generous for real work and still bounds a `while (true)`.
 */
export const DEFAULT_TURN_TIMEOUT_MS = 5_000;

/**
 * Cap on simultaneously-live guest timers. A timer flood is a denial-of-service
 * on the *supervisor's* event loop rather than on the guest, so the limit is
 * enforced host-side where the clocks actually are.
 */
export const DEFAULT_MAX_PENDING_TIMERS = 256;

/**
 * Read the realm's WASM linear memory. Wrapped because it is the one piece of
 * the memory ceiling that depends on an accessor the engine wrapper is free to
 * change; if it ever disappears the ceiling degrades to "not enforced" rather
 * than throwing at realm construction, and `MemoryCeilingUnavailableError`
 * below documents what that costs.
 */
function safeGetWasmMemory(wasm: QuickJSWASMModule): WebAssembly.Memory | undefined {
  try {
    return wasm.getWasmMemory();
  } catch {
    return undefined;
  }
}

/** Source of the extension's entry bundle, resolved and read by the supervisor. */
export interface EntryBundle {
  /** The bundle's JavaScript source. */
  source: string;
  /** Display name used in guest stack traces. */
  filename: string;
}

export interface QuickJSRealmOpts {
  /** Owning extension - used only in diagnostics. */
  extensionId: string;
  /** The bundled guest runtime (`extension-runtime/guest`), as source. */
  guestBundleSource: string;
  /**
   * Produces the extension's entry bundle. Called lazily, during the guest's
   * `runtime.init`, so a resolution or read failure surfaces as a normal
   * `module-load` error on the extension rather than a supervisor crash.
   */
  loadEntryBundle: () => EntryBundle;
  /** Guest -> host: one RPC envelope. */
  onSend: (envelope: unknown) => void;
  /** Guest -> host: a `console.*` call. */
  onLog: (level: string, args: unknown[]) => void;
  /** The guest could not activate. The supervisor tears the realm down. */
  onFatal: (message: string) => void;
  /**
   * The guest exceeded its turn deadline or memory limit. Distinct from
   * `onFatal`: the realm is still structurally intact, but the extension
   * misbehaved and the host may want to disable it.
   */
  onResourceViolation?: (kind: 'timeout' | 'memory' | 'timer-flood', detail: string) => void;

  memoryLimitBytes?: number;
  maxStackBytes?: number;
  turnTimeoutMs?: number;
  maxPendingTimers?: number;
  /** Injected in tests. Defaults to the bundled singlefile WASM variant. */
  wasmModule?: QuickJSWASMModule;
}

/**
 * Instantiate a WASM module for one realm.
 *
 * Deliberately NOT shared between realms, for two reasons:
 *
 *   1. The memory ceiling is measured as growth of the module's WASM heap, and
 *      that heap is per-module. Two extensions sharing a module would be
 *      charged for each other's allocations.
 *   2. Tearing a realm down after a QuickJS out-of-memory can abort the module
 *      (see `dispose`). A per-realm module confines that to the extension being
 *      torn down instead of poisoning every other extension in the process.
 *
 * quickjs-emscripten documents this as the stronger isolation tier, "at the
 * cost of memory usage". In production the cost is nil: there is one extension
 * per utilityProcess, hence one realm per process either way.
 *
 * The variant module itself is cached - it is inert data, and re-`import()`ing
 * a few MB of base64 per extension would be pure waste.
 */
/**
 * The concrete sync variant. Taken from the package's own default export so it
 * stays `QuickJSSyncVariant` rather than the sync|async union - `newVariant` is
 * generic and preserves whichever it is given, but the module factory only
 * accepts the sync one.
 */
type SyncVariant = (typeof import('@jitl/quickjs-singlefile-cjs-release-sync'))['default'];
let cachedVariant: Promise<SyncVariant> | undefined;

export async function createIsolatedQuickJSModule(
  memoryLimitBytes: number,
): Promise<QuickJSWASMModule> {
  // The `singlefile` variant inlines the WASM as base64 inside its JS, so there
  // is no `.wasm` file to locate at runtime and nothing to add to `asarUnpack`.
  // That matters: a separate binary would have to be unpacked from the asar and
  // then found relative to a bundled entry script.
  //
  // The package is CommonJS, so the variant may arrive as `.default` or as the
  // namespace itself depending on the interop the bundler emits.
  cachedVariant ??= import('@jitl/quickjs-singlefile-cjs-release-sync').then((mod) => {
    const ns = mod as unknown as { default?: SyncVariant };
    return ns.default ?? (ns as unknown as SyncVariant);
  });
  const base = await cachedVariant;

  // The memory is what makes the ceiling real, so it is created per realm with
  // an explicit maximum. `newVariant` exists for exactly this substitution.
  const maxPages = WASM_INITIAL_PAGES + Math.ceil(memoryLimitBytes / WASM_PAGE_BYTES);
  const memory = new WebAssembly.Memory({ initial: WASM_INITIAL_PAGES, maximum: maxPages });
  return newQuickJSWASMModuleFromVariant(newVariant(base, { wasmMemory: memory }));
}

/**
 * QuickJS reports a memory-limit hit as an `InternalError: out of memory`.
 * Matched by message because there is no distinguishable error type - the
 * engine reuses `InternalError` for stack overflow too, which carries a
 * different message and is a different (already-bounded) failure.
 */
function isOutOfMemory(message: string): boolean {
  return /out of memory/i.test(message);
}

/**
 * Parse an envelope far enough to recover its `id`, ignoring the codec.
 *
 * Used only on the failure path, where the codec has already refused the
 * payload: `JSON.parse` still succeeds for an over-deep or wrongly-tagged
 * envelope, and the request id sitting at the top level is all that is needed
 * to answer it.
 */
function shallowParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/**
 * Build the error reply that stands in for an envelope the codec could not
 * carry. Returns `undefined` when there is nothing to reply to - an event or
 * a heartbeat has no waiting promise on the other side, so dropping it is the
 * only option and the caller logs instead.
 *
 * `back` says which way the reply has to travel, which is the opposite of the
 * envelope's own direction for a `request` and the *same* direction for a
 * `response` - in both cases it is whoever holds the pending promise. Getting
 * this backwards would deliver the reply to the side that was not waiting and
 * leave the one that was hanging anyway.
 */
function errorResponseFor(
  envelope: unknown,
  detail: string,
): { reply: unknown; back: boolean } | undefined {
  const env = envelope as { kind?: unknown; id?: unknown } | null | undefined;
  if (!env || typeof env !== 'object') return undefined;
  if (env.kind !== 'request' && env.kind !== 'response') return undefined;
  if (typeof env.id !== 'string') return undefined;
  return {
    reply: {
      kind: 'response',
      id: env.id,
      error: { code: 'RpcProtocolError', message: detail },
    },
    back: env.kind === 'request',
  };
}

/** Thrown when guest code is interrupted for exceeding its turn deadline. */
export class GuestTimeoutError extends Error {
  constructor(extensionId: string, ms: number) {
    super(`Extension '${extensionId}' exceeded its ${ms}ms execution budget and was interrupted`);
    this.name = 'GuestTimeoutError';
  }
}

interface GuestFunctions {
  receive: QuickJSHandle;
  fireTimer: QuickJSHandle;
  dispose: QuickJSHandle;
}

export class QuickJSRealm {
  private readonly opts: Required<
    Pick<
      QuickJSRealmOpts,
      'extensionId' | 'guestBundleSource' | 'loadEntryBundle' | 'onSend' | 'onLog' | 'onFatal'
    >
  > &
    QuickJSRealmOpts;

  private readonly wasm: QuickJSWASMModule;
  private readonly runtime: QuickJSRuntime;
  private readonly context: QuickJSContext;
  private readonly injected: QuickJSHandle[] = [];
  private readonly hostTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private guestFns: GuestFunctions | undefined;

  /** WASM heap size at realm creation - the baseline the ceiling is measured from. */
  private readonly baselineHeapBytes: number;
  private readonly wasmMemory: WebAssembly.Memory | undefined;

  /** Absolute ms deadline for the current guest turn; `undefined` between turns. */
  private turnDeadline: number | undefined;
  /** Why the interrupt handler fired, so the turn can report it precisely. */
  private interruptReason: 'timeout' | 'memory' | undefined;
  private disposed = false;
  private inGuest = false;
  /**
   * Set once the realm has hit a real QuickJS out-of-memory. From that point
   * the engine's own teardown is unsafe to run - see `dispose`.
   */
  private engineFaulted = false;

  private constructor(
    opts: QuickJSRealmOpts,
    wasm: QuickJSWASMModule,
    runtime: QuickJSRuntime,
    context: QuickJSContext,
  ) {
    this.opts = opts as QuickJSRealm['opts'];
    this.wasm = wasm;
    this.runtime = runtime;
    this.context = context;
    this.wasmMemory = safeGetWasmMemory(wasm);
    this.baselineHeapBytes = this.heapBytes();
  }

  /**
   * Current WASM heap size. O(1) - a property read on the memory object - which
   * matters because the interrupt handler runs roughly every 35 us of guest
   * execution. Note `memory.buffer` is replaced by a fresh ArrayBuffer whenever
   * the heap grows, so it has to be re-read rather than cached.
   */
  private heapBytes(): number {
    return this.wasmMemory?.buffer.byteLength ?? 0;
  }

  /**
   * Build a realm, inject the host bridge, and evaluate the guest runtime
   * bundle into it. The extension's own code is NOT loaded here - that happens
   * during `runtime.init`, when the guest asks for it.
   */
  static async create(opts: QuickJSRealmOpts): Promise<QuickJSRealm> {
    const memoryLimit = opts.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES;
    const wasm = opts.wasmModule ?? (await createIsolatedQuickJSModule(memoryLimit));
    const runtime = wasm.newRuntime();
    // Applied as a third, weakest signal - see DEFAULT_MEMORY_LIMIT_BYTES for
    // why nothing may depend on it.
    runtime.setMemoryLimit(memoryLimit);
    runtime.setMaxStackSize(opts.maxStackBytes ?? DEFAULT_MAX_STACK_BYTES);

    const context = runtime.newContext();
    const realm = new QuickJSRealm(opts, wasm, runtime, context);

    runtime.setInterruptHandler(() => {
      if (realm.disposed) return true;
      const deadline = realm.turnDeadline;
      if (deadline !== undefined && Date.now() > deadline) {
        realm.interruptReason = 'timeout';
        return true;
      }
      // Opportunistic early stop. The hard bound is the WASM memory maximum;
      // this only tries to get there first, because an interrupt unwinds
      // cleanly whereas a genuine QuickJS OOM strands a context reference (see
      // `dispose`). Polling is far too coarse to be the bound itself.
      if (realm.heapBytes() - realm.baselineHeapBytes > memoryLimit * MEMORY_PRESSURE_FRACTION) {
        realm.interruptReason = 'memory';
        return true;
      }
      return false;
    });

    try {
      realm.injectHostBridge();
      realm.evalGuestBundle();
      realm.captureGuestFunctions();
    } catch (err) {
      realm.dispose();
      throw err;
    }
    return realm;
  }

  // --- Host -> guest --------------------------------------------------------

  /** Deliver one RPC envelope into the realm. */
  deliver(envelope: unknown): void {
    if (this.disposed) return;

    let json: string;
    try {
      json = encodeEnvelope(envelope);
    } catch (err) {
      // A payload the codec cannot represent must not silently vanish: if this
      // was the response to a guest request, dropping it leaves the
      // extension's `await` pending forever. Substitute a failure the guest
      // can actually observe, and only give up when there is no request to
      // answer.
      const detail = err instanceof Error ? err.message : String(err);
      const substitute = errorResponseFor(envelope, detail);
      if (!substitute) {
        this.opts.onLog('error', [`dropped an unencodable envelope for the realm: ${detail}`]);
        return;
      }
      // `back` points at whoever originated this envelope. Here that is the
      // host, so a failed reverse-RPC `request` is answered on the host side
      // and never enters the realm at all; a failed `response` still has to
      // reach the guest, which is the side awaiting it.
      if (substitute.back) {
        this.opts.onSend(substitute.reply);
        return;
      }
      json = JSON.stringify(substitute.reply);
    }

    this.enterGuest('deliver', (ctx) => {
      const arg = ctx.newString(json);
      try {
        return ctx.callFunction(this.guestFns!.receive, ctx.undefined, arg);
      } finally {
        arg.dispose();
      }
    });
  }

  /**
   * Deliver an envelope on a later tick.
   *
   * Needed when the host synthesises a reply from *inside* a guest turn - a
   * host bridge function is on the stack, so `enterGuest` would (correctly)
   * refuse to re-enter the interpreter. Unref'd: a synthetic error reply is
   * never a reason to keep the process alive.
   */
  private deliverLater(envelope: unknown): void {
    const handle = setTimeout(() => {
      if (!this.disposed) this.deliver(envelope);
    }, 0);
    (handle as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * Run the extension's `deactivate()` and drop its subscriptions. Best
   * effort: the realm is disposed regardless of what the guest does here.
   */
  requestGuestDispose(): void {
    if (this.disposed || !this.guestFns) return;
    this.enterGuest('dispose', (ctx) =>
      ctx.callFunction(this.guestFns!.dispose, ctx.undefined),
    );
  }

  /** Tear the realm down. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const timer of this.hostTimers.values()) clearTimeout(timer);
    this.hostTimers.clear();

    // Freeing a QuickJS runtime that has hit a *genuine* out-of-memory aborts
    // inside WASM:
    //
    //   Object leaks:  ADDRESS REFS SHRF PROTO CONTENT
    //                 0x1e19500   1        [js_context]
    //   Aborted(Assertion failed: list_empty(&rt->gc_obj_list), JS_FreeRuntime)
    //
    // The debug build's leak report is unambiguous: exactly one object survives
    // and it is the JSContext itself, holding one stranded reference. It is an
    // engine-side refcount leak on the OOM unwind path - reproduced with the
    // engine alone, unaffected by teardown order, by draining the job queue, by
    // lifting the memory limit, or by skipping `context.dispose()`, and present
    // in quickjs-ng too. Nothing here can prevent it.
    //
    // So the realm is *discarded* rather than freed: every reference is dropped
    // and V8 reclaims the module. Its linear memory is an ordinary
    // `WebAssembly.Memory` object, and this realm owns the entire module (see
    // `createIsolatedQuickJSModule`), so there is nothing left inside it that
    // anyone could still be using.
    //
    // This is unconditional rather than "only after an out-of-memory", because
    // there is no reliable way to know an OOM happened. An extension is free to
    // catch it and say nothing - `try { new Array(1e8) } catch {}` leaves no
    // `__runtime.error`, and no heap growth either, since the allocation that
    // failed never got its memory. Guessing wrong costs a crashed worker, and
    // guessing right saves nothing: freeing a module we are throwing away is
    // redundant by construction once each realm owns its own.
    //
    // `engineFaulted` is kept because it is worth reporting; it just no longer
    // decides anything here.
    this.guestFns = undefined;
    this.injected.length = 0;
    void this.wasm;
    void this.runtime;
    void this.context;
    void this.engineFaulted;
  }

  /**
   * How far the realm's WASM heap has grown past its baseline - the quantity
   * the memory ceiling is enforced against.
   *
   * Note this only ever rises: WASM linear memory cannot shrink, so freeing
   * inside the realm does not lower it. It is also *coarse*. Emscripten grows
   * the heap geometrically, so a single allocation step can overshoot the
   * ceiling considerably before the interrupt handler next observes it - the
   * effective bound is a small multiple of the configured limit, not the limit
   * exactly. That is a bound nonetheless, which is the part that matters; the
   * mechanism it replaced allowed 200x the configured limit.
   */
  heapGrowthBytes(): number {
    return Math.max(0, this.heapBytes() - this.baselineHeapBytes);
  }

  /** Bytes currently allocated inside the realm, per QuickJS. Diagnostics only. */
  memoryUsageBytes(): number {
    if (this.disposed) return 0;
    const handle = this.runtime.computeMemoryUsage();
    try {
      const dumped = this.context.dump(handle) as { memory_used_size?: number } | null;
      return typeof dumped?.memory_used_size === 'number' ? dumped.memory_used_size : 0;
    } finally {
      handle.dispose();
    }
  }

  // --- Guest turn management ------------------------------------------------

  /**
   * Run one guest turn under an interrupt deadline, then drain the realm's
   * microtask queue.
   *
   * Draining matters more than it looks: QuickJS resolves promises onto its own
   * job queue and nothing pumps it for us. An RPC response delivered without a
   * subsequent `executePendingJobs()` would leave the `await` in the
   * extension's `activate()` permanently unresolved - the same class of hang
   * the pre-init envelope split in `bootstrap.ts` exists to prevent.
   */
  private enterGuest(
    label: string,
    body: (ctx: QuickJSContext) => { value: QuickJSHandle } | { error: QuickJSHandle },
  ): void {
    if (this.disposed) return;
    if (this.inGuest) {
      // Re-entering the interpreter from inside a host function called *by*
      // the interpreter would corrupt its stack. Nothing in the supervisor
      // does this today; the guard is here so that if something ever does, it
      // fails loudly instead of subtly.
      throw new Error(`QuickJSRealm re-entered during '${label}' — host bridge must not call back in`);
    }

    const timeoutMs = this.opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.inGuest = true;
    this.interruptReason = undefined;
    this.turnDeadline = Date.now() + timeoutMs;
    try {
      const result = body(this.context);
      this.settle(label, result);
      // Microtasks queued by the turn run under the same deadline.
      this.drainJobs(label);
    } finally {
      // Report the interrupt at *turn* level, not from wherever the exception
      // happened to surface. An interrupt lands as an ordinary throw inside
      // guest code, so extension code that wraps its work in try/catch - which
      // `runtime.init` does, by design - swallows it and the host would
      // otherwise never learn the extension had to be stopped.
      const reason = this.interruptReason;
      if (reason === 'timeout') {
        this.opts.onResourceViolation?.(
          'timeout',
          `${label}: ${new GuestTimeoutError(this.opts.extensionId, timeoutMs).message}`,
        );
      } else if (reason === 'memory') {
        const used = this.heapBytes() - this.baselineHeapBytes;
        this.opts.onResourceViolation?.(
          'memory',
          `${label}: extension '${this.opts.extensionId}' exceeded its memory ceiling ` +
            `(${Math.round(used / 1048576)} MB) and was interrupted`,
        );
      }
      this.turnDeadline = undefined;
      this.inGuest = false;
    }
  }

  private drainJobs(label: string): void {
    const result = this.runtime.executePendingJobs();
    if ('error' in result && result.error) {
      this.reportGuestError(`${label}:microtask`, result.error);
      result.error.dispose();
    }
  }

  private settle(
    label: string,
    result: { value: QuickJSHandle } | { error: QuickJSHandle },
  ): void {
    if ('error' in result && result.error) {
      this.reportGuestError(label, result.error);
      result.error.dispose();
      return;
    }
    if ('value' in result) result.value.dispose();
  }

  /**
   * Turn a guest-side throw into something the host can act on. An interrupt
   * is reported as a resource violation rather than an ordinary error: the
   * extension did not fail, it was stopped.
   */
  private reportGuestError(label: string, errorHandle: QuickJSHandle): void {
    const dumped = this.context.dump(errorHandle) as
      | { name?: string; message?: string; stack?: string }
      | string
      | null;
    const message =
      typeof dumped === 'string' ? dumped : (dumped?.message ?? 'unknown guest error');

    // An interrupt is reported once, by `enterGuest`, for the whole turn.
    if (this.interruptReason !== undefined) return;

    if (isOutOfMemory(message)) {
      this.engineFaulted = true;
      this.opts.onResourceViolation?.('memory', `${label}: ${message}`);
      return;
    }
    // Ordinary guest exception - route it to the host as a runtime error event
    // so it lands in the extension's log like any other crash.
    this.opts.onSend({
      kind: 'event',
      channel: '__runtime.error',
      payload: {
        source: label,
        message,
        stack: typeof dumped === 'object' && dumped ? dumped.stack : undefined,
      },
    });
  }

  /**
   * Recognise a memory-limit hit that guest code has already caught.
   *
   * Exceeding the QuickJS memory limit raises an ordinary `InternalError`
   * inside the realm, so whichever `try/catch` is innermost gets it first -
   * usually `runtime.init`'s, which turns it into a routine `__runtime.error`
   * report. By the time the turn returns to the host the bomb's allocations
   * have been freed by the unwind, so there is nothing left to measure. The
   * only reliable host-side signal is therefore the error itself, on its way
   * past on the realm's own transport.
   *
   * This is a classification, not a control: the limit is what stopped the
   * extension. This is how the host gets *told* so it can act on a repeat
   * offender.
   */
  private classifyRuntimeError(envelope: unknown): void {
    const env = envelope as { kind?: string; channel?: string; payload?: { message?: string } };
    if (env?.kind !== 'event' || env.channel !== '__runtime.error') return;
    const message = env.payload?.message;
    if (typeof message === 'string' && isOutOfMemory(message)) {
      this.engineFaulted = true;
      this.opts.onResourceViolation?.('memory', message);
    }
  }

  // --- Realm construction ---------------------------------------------------

  /** Install a host function as a global and remember it for disposal. */
  private defineHostFunction(
    name: string,
    impl: (ctx: QuickJSContext, args: QuickJSHandle[]) => QuickJSHandle | void,
  ): void {
    const ctx = this.context;
    const fn = ctx.newFunction(name, (...args) => {
      try {
        return impl(ctx, args) ?? undefined;
      } catch (err) {
        // A host-side throw must become a guest-side exception, not an
        // exception unwinding through the interpreter's C stack.
        return { error: ctx.newError(err instanceof Error ? err.message : String(err)) };
      }
    });
    ctx.setProp(ctx.global, name, fn);
    this.injected.push(fn);
  }

  private injectHostBridge(): void {
    const ctx = this.context;

    this.defineHostFunction('__host_send', (c, args) => {
      const json = args[0] ? c.getString(args[0]) : '';
      let envelope: unknown;
      try {
        envelope = decodeEnvelope(json);
      } catch (err) {
        // The guest sent something the codec refuses - an over-deep payload or
        // a corrupt binary tag. Answer its request with an error rather than
        // dropping it, so the extension gets a rejected promise instead of one
        // that never settles. A non-request envelope has nothing to answer, so
        // it is dropped and logged.
        const detail = err instanceof Error ? err.message : String(err);
        const substitute = errorResponseFor(shallowParse(json), detail);
        if (!substitute) {
          this.opts.onLog('error', [`dropped an undecodable envelope from the realm: ${detail}`]);
          return;
        }
        // Here the originator is the guest, so its own failed `request` is
        // answered back into the realm; a failed `response` belongs to a host
        // reverse-RPC that is still awaiting it.
        if (substitute.back) this.deliverLater(substitute.reply);
        else this.opts.onSend(substitute.reply);
        return;
      }
      this.classifyRuntimeError(envelope);
      this.opts.onSend(envelope);
    });

    this.defineHostFunction('__host_log', (c, args) => {
      const level = args[0] ? c.getString(args[0]) : 'log';
      const json = args[1] ? c.getString(args[1]) : '[]';
      let parsed: unknown[];
      try {
        parsed = JSON.parse(json) as unknown[];
      } catch {
        parsed = [json];
      }
      this.opts.onLog(level, Array.isArray(parsed) ? parsed : [parsed]);
    });

    this.defineHostFunction('__host_fatal', (c, args) => {
      const json = args[0] ? c.getString(args[0]) : '{}';
      let message = 'extension failed to activate';
      try {
        const parsed = JSON.parse(json) as { message?: string };
        if (typeof parsed.message === 'string') message = parsed.message;
      } catch {
        /* keep the default */
      }
      this.opts.onFatal(message);
    });

    this.defineHostFunction('__host_setTimer', (c, args) => {
      const id = args[0] ? c.getNumber(args[0]) : 0;
      const delayMs = args[1] ? c.getNumber(args[1]) : 0;
      const repeating = args[2] ? c.dump(args[2]) === true : false;
      this.armTimer(id, delayMs, repeating);
    });

    this.defineHostFunction('__host_clearTimer', (c, args) => {
      const id = args[0] ? c.getNumber(args[0]) : 0;
      const timer = this.hostTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.hostTimers.delete(id);
      }
    });

    this.defineHostFunction('__host_loadEntryModule', () => this.loadEntryModuleIntoRealm());

    void ctx;
  }

  private armTimer(id: number, delayMs: number, repeating: boolean): void {
    const cap = this.opts.maxPendingTimers ?? DEFAULT_MAX_PENDING_TIMERS;
    if (!this.hostTimers.has(id) && this.hostTimers.size >= cap) {
      this.opts.onResourceViolation?.(
        'timer-flood',
        `extension '${this.opts.extensionId}' exceeded its limit of ${cap} pending timers`,
      );
      throw new Error(`Timer limit of ${cap} reached`);
    }

    const fire = (): void => {
      if (this.disposed) return;
      if (!repeating) this.hostTimers.delete(id);
      // The guest is entered from the host's event loop here, not from inside
      // another guest turn, so `enterGuest` re-arms the deadline correctly.
      this.enterGuest('timer', (ctx) => {
        const arg = ctx.newNumber(id);
        try {
          return ctx.callFunction(this.guestFns!.fireTimer, ctx.undefined, arg);
        } finally {
          arg.dispose();
        }
      });
    };

    const existing = this.hostTimers.get(id);
    if (existing) clearTimeout(existing);
    const handle = repeating ? setInterval(fire, delayMs) : setTimeout(fire, delayMs);
    // A pending extension timer must never be the reason the process stays up.
    (handle as unknown as { unref?: () => void }).unref?.();
    this.hostTimers.set(id, handle);
  }

  private evalGuestBundle(): void {
    const ctx = this.context;
    // No deadline here: this is our own trusted bundle, and the interrupt
    // handler is not yet meaningful because no guest code has run.
    const result = ctx.evalCode(this.opts.guestBundleSource, 'bible-extension-runtime.js');
    if (result.error) {
      const dumped = ctx.dump(result.error) as { message?: string } | null;
      result.error.dispose();
      throw new Error(`Extension guest runtime failed to load: ${dumped?.message ?? 'unknown'}`);
    }
    result.value.dispose();
  }

  private captureGuestFunctions(): void {
    const ctx = this.context;
    const grab = (name: string): QuickJSHandle => {
      const handle = ctx.getProp(ctx.global, name);
      if (ctx.typeof(handle) !== 'function') {
        handle.dispose();
        throw new Error(`Extension guest runtime did not define ${name}`);
      }
      return handle;
    };
    this.guestFns = {
      receive: grab('__guest_receive'),
      fireTimer: grab('__guest_fireTimer'),
      dispose: grab('__guest_dispose'),
    };
  }

  /**
   * Evaluate the extension's entry bundle in the realm and return its
   * `module.exports`.
   *
   * The CJS prologue is kept on the *same line* as the first line of the
   * bundle so guest stack traces keep the author's line numbers - the same
   * trick Node's module wrapper uses.
   */
  private loadEntryModuleIntoRealm(): QuickJSHandle {
    const ctx = this.context;
    const bundle = this.opts.loadEntryBundle();

    const wrapped = ctx.evalCode(
      `(function (exports, module, require) {${bundle.source}\n})`,
      bundle.filename,
    );
    if (wrapped.error) {
      const dumped = ctx.dump(wrapped.error) as { message?: string } | null;
      wrapped.error.dispose();
      throw new Error(`Failed to parse extension bundle: ${dumped?.message ?? 'unknown'}`);
    }

    const fn = wrapped.value;
    const moduleObj = ctx.newObject();
    const exportsObj = ctx.newObject();
    ctx.setProp(moduleObj, 'exports', exportsObj);

    // Extensions ship as ONE self-contained bundle. Anything that
    // still calls `require` gets an error naming the specifier rather than a
    // bare `require is not defined`, because the fix - bundle it - is not
    // obvious from the latter.
    const requireStub = ctx.newFunction('require', (specHandle) => {
      const spec = specHandle ? ctx.getString(specHandle) : '<unknown>';
      return {
        error: ctx.newError(
          `Cannot require('${spec}'): extensions run in a sandboxed realm with no module system. ` +
            `Bundle your dependencies into a single file (see the extension authoring guide). ` +
            `Node built-ins are not available at all.`,
        ),
      };
    });

    try {
      const called = ctx.callFunction(fn, ctx.undefined, exportsObj, moduleObj, requireStub);
      if (called.error) {
        const dumped = ctx.dump(called.error) as { message?: string } | null;
        called.error.dispose();
        throw new Error(`Extension bundle threw while loading: ${dumped?.message ?? 'unknown'}`);
      }
      called.value.dispose();
      // Read `exports` back off `module` - a bundle is free to replace it
      // wholesale with `module.exports = {...}`, which is the common case.
      return ctx.getProp(moduleObj, 'exports');
    } finally {
      fn.dispose();
      moduleObj.dispose();
      exportsObj.dispose();
      requireStub.dispose();
    }
  }
}
