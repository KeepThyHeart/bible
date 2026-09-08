# Diagnostics & Issue Reporting

**Last verified:** 2026-09-08

Opt-in, privacy-preserving system for sending crash reports and manual issue reports. Reports are collected locally as JSON files, previewed before sending, and queued for background upload when the user is online.

## Files

### Services (Main Process)

| File | Description |
|---|---|
| `electron/services/DiagnosticsService.ts` | Collection layer: IPC breadcrumb ring, error capture, sanitizer, payload builders for crash / manual / feedback. Also exports `BUILD_ID` |
| `electron/services/DiagnosticsQueue.ts` | Filesystem-backed queue at `{userData}/diagnostics/queue/`; one JSON file per report, size-capped with FIFO eviction |
| `electron/services/DiagnosticsConfig.ts` | Small sync JSON config store at `{userData}/diagnostics/config.json` (enabled flag, endpoint URL, "don't ask again") |
| `electron/services/DiagnosticsUploader.ts` | Background uploader using Electron's `net` module; serial POSTs, one attempt per file per tick, respects `429 Retry-After` |

### IPC

| File | Description |
|---|---|
| `electron/ipc/diagnosticsHandlers.ts` | Handler registration + lazy singleton wiring for the four services; defines the `SubmitReceipt` shape |
| `electron/ipc/allowedChannels.ts` | Allow-list entries for all `diagnostics:*` channels (see list below) |
| `electron/utils/ipcBreadcrumb.ts` | `withBreadcrumb` - wraps an IPC handler so each invocation is recorded in the service's ring buffer (channel name + timestamp + error flag). Arguments are never auto-serialized; a caller opts in to a short non-sensitive summary via `opts.safeArgs` |
| `electron/preload.ts` | `window.electron.diagnostics.*` bridge: `getQueue`, `getReport`, `deleteReport`, `deleteAll`, `submitCrashReport`, `submitManualReport`, `submitFeedback`, `getStateSnapshot`, `getConfig`, `setConfig`, `reportRendererError`, `flushNow`, `onCrashDetected` |

### Main Process Wiring

| File | Description |
|---|---|
| `electron/main.ts` | Installs `uncaughtException` / `unhandledRejection` hooks that call `DiagnosticsService.captureMainError`, enqueue the payload, and send `diagnostics:crash-detected` to the renderer. Also stops the uploader timer on shutdown. |
| `electron/config/constants.ts` | `DIAGNOSTICS_QUEUE_MAX` (50), `DIAGNOSTICS_RING_SIZE` (20), `DIAGNOSTICS_CRASHES_PER_SESSION_CAP` (10), `DIAGNOSTICS_UPLOAD_INTERVAL_MS` (30 min), `DIAGNOSTICS_UPLOAD_TIMEOUT_MS` (15 s), `DIAGNOSTICS_UPLOAD_INITIAL_DELAY_MS` (5 s), `DIAGNOSTICS_DEFAULT_ENABLED` (false), `DIAGNOSTICS_DEFAULT_ENDPOINT` and `DIAGNOSTICS_SHARED_TOKEN` (both baked in from the environment, empty by default) |

### Renderer (UI)

| File | Description |
|---|---|
| `src/ui/components/diagnostics/CrashReportDialog.tsx` | In-app dialog shown when main-process error is captured; plain-English summary + expandable JSON + description textarea + "Don't ask again" |
| `src/ui/components/diagnostics/ReportIssueDialog.tsx` | User-initiated "Report an Issue" dialog; description + "Include app diagnostics" toggle + preview panel + the thank-you panel shown on success (see "The thank-you says only what is true" below) |
| `src/ui/components/diagnostics/DiagnosticsSettings.tsx` | Settings panel: toggle crash prompt, view/delete queued reports, "Send All Now", endpoint URL override. Rendered by `src/ui/components/PreferencesDialog.tsx` as the `diagnostics` section - there is no separate command or menu entry for it |
| `src/ui/components/diagnostics/privacyBlurb.ts` | Shared plain-English summary text used by both dialogs |
| `src/ui/components/ErrorBoundary.tsx` | React error boundary that forwards captures to `diagnostics:report-renderer-error` |
| `src/ui/main.tsx` | Installs `window.addEventListener('error')` / `('unhandledrejection')` listeners that forward to `diagnostics:report-renderer-error` |
| `src/ui/App.tsx` | Mounts `CrashReportDialog` and `ReportIssueDialog` unconditionally; the `diagnostics:crash-detected` subscription itself lives inside `CrashReportDialog` (`onCrashDetected`) |
| `src/ui/commands/diagnosticsCommands.ts` | Registers exactly one command, `help.reportIssue`, which dispatches `command:help:reportIssue` to open the in-app dialog. Distinct from `app.reportIssue` in `src/ui/commands/appCommands.ts`, which opens the maintainer's external tracker and is only registered when `BIBLE_ISSUE_REPORT_URL` is set |

### Tests

| File | Description |
|---|---|
| `electron/services/__tests__/DiagnosticsService.test.ts` | Payload shape, sanitizer, per-session cap, dedup, ring buffer |
| `electron/services/__tests__/DiagnosticsQueue.test.ts` | Enqueue/list/read/delete round-trip, filename format, eviction at cap |
| `electron/services/__tests__/DiagnosticsUploader.test.ts` | HTTP outcomes (200/400/429/500), disabled/offline/empty-endpoint guards, crash `pending_send` gate |
| `src/ui/components/diagnostics/ReportIssueDialog.test.tsx` | Both thank-you wordings, the unknown-receipt fallback, the untouched error branch, the dialog staying open until dismissed, and a clean form on reopen |
| `e2e/tests/diagnostics.spec.ts` | End-to-end IPC round-trip: submit feedback, inspect queue, verify privacy shape, clear queue |

## Storage Locations

- **Queue:** `{app.getPath('userData')}/diagnostics/queue/{ISOts}-{type}-{shortId}.json`
- **Config:** `{app.getPath('userData')}/diagnostics/config.json`

Both locations are plain JSON - power users and support engineers can inspect or delete files by hand.

## IPC Channels

All channels return `Result<T>` envelopes (`{ ok: true, value } | { ok: false, error: { code, message } }`) per `electron/ipc/handler-helper.ts`.

| Channel | Direction | Purpose |
|---|---|---|
| `diagnostics:get-queue` | R -> M | List queued reports |
| `diagnostics:get-report` | R -> M | Read one queued report's full JSON |
| `diagnostics:delete-report` | R -> M | Delete a single queued report |
| `diagnostics:delete-all` | R -> M | Clear the queue |
| `diagnostics:submit-crash-report` | R -> M | Attach description to a captured crash and mark it pending send |
| `diagnostics:submit-manual-report` | R -> M | Build + enqueue a manual report (`state` only if `includeDiagnostics=true`). Returns a `SubmitReceipt` |
| `diagnostics:submit-feedback` | R -> M | Build + enqueue a plain-text feedback report. Returns a `SubmitReceipt` |
| `diagnostics:get-state-snapshot` | R -> M | Preview the state snapshot that would be attached |
| `diagnostics:get-config` / `set-config` | R -> M | Read/write enabled, endpointUrl, dontAskAgain |
| `diagnostics:flush-now` | R -> M | Run a single uploader tick immediately |
| `diagnostics:report-renderer-error` | R -> M | Renderer forwards unhandled errors to the collection layer |
| `diagnostics:crash-detected` | M -> R | Main signals the renderer to show the crash dialog |

## HTTP API Contract (for receiver implementers)

The desktop app POSTs one JSON payload per report to `config.endpointUrl` with the following headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json; charset=utf-8` |
| `User-Agent` | `App/{version}` |
| `X-Report-Type` | `crash` \| `manual` \| `feedback` |
| `X-Report-Id` | Short random id from the payload |
| `X-App-Version` | Same as `app.getVersion()` |
| `X-Build-Id` | Git short SHA the binary was built from (omitted when empty) |
| `X-Report-Token` | Shared build token, when the build has one (omitted otherwise) |

No header name says "Bible", and the `User-Agent` carries no platform or architecture, so a `feedback` report - which the Report an Issue dialog promises is description-only when "Include diagnostic information" is left unchecked - discloses no OS. Crash and manual payloads carry `os` and `arch` in the body, where the privacy blurb discloses them and the user has agreed to send them.

**`X-Report-Token`** is a shared secret compiled in from `BIBLE_DIAGNOSTICS_TOKEN`. It is the same value in every copy of a release and identifies nobody; its only job is to stop an open POST endpoint being trivially discoverable by bots. That matters because the reference receiver stores no IP address and so cannot rate-limit a flood by origin.

**Response handling:**

| Status | Uploader behavior |
|---|---|
| `200` / `202` | File deleted from queue |
| `400` / `413` | Permanent failure - file deleted, `counts.failed` incremented |
| `429` | Rate-limited - loop breaks for this tick; `Retry-After` header is logged but not otherwise enforced (next tick picks up in 30 min) |
| `5xx` / network error / timeout | Transient - file stays queued, retried next tick |
| Unknown status | Treated as transient (fail-safe against misconfigured reverse proxies) |

Crash and manual payloads include `app_version`, `electron_version`, `os` (kernel name + release only - no hostname) and `arch`. A crash payload adds `error` (message, type, stack), `method`, the breadcrumb ring as `recent_ipc`, and the `pending_send` consent flag; a manual payload adds `state` only when the user ticked "Include app diagnostics". Feedback payloads carry only `app_version` and `user_description`. All three carry `report_id`, `type` and `timestamp`, plus `build_id` when the build has one.

## The thank-you says only what is true

Both submit channels return a `SubmitReceipt` (`electron/ipc/diagnosticsHandlers.ts`) rather than the bare queue id:

```ts
interface SubmitReceipt {
  reportId: string;
  willUpload: boolean;   // cfg.enabled && cfg.endpointUrl.trim() !== ''
}
```

`ReportIssueDialog` shows a thank-you panel with a single Close button, and the receipt decides which sentence that panel carries, because the app is usually not entitled to say "sent":

- **`willUpload: true`** - "Your feedback has been sent - it is queued for upload and will go out in the background."
- **`willUpload: false`** - "Your report has been saved on this computer. It will be sent once a feedback endpoint is configured in Preferences -> Diagnostics."

Submitting only *enqueues*. `DiagnosticsUploader.tick()` runs on a 30-minute timer and bails immediately on `!cfg.enabled || !cfg.endpointUrl.trim()`, and both default off/empty (`DIAGNOSTICS_DEFAULT_ENABLED` / `DIAGNOSTICS_DEFAULT_ENDPOINT`). On a stock install nothing has been sent and nothing will be until the user configures a destination, so "thank you, that's been sent" would be a straightforward falsehood. `willUpload` is computed from the same condition the uploader guards on, so the two cannot drift into telling the user different stories.

Deliberately excluded from `willUpload`: offline mode and the connectivity probe, which the uploader also checks. Those resolve by themselves, and a report merely waiting for the network really is going to be sent.

The renderer's `willUploadFromEnvelope` reads an unrecognised value - a main process returning the bare report id, a changed envelope shape - as `false`. The saved-locally wording is true whether or not an endpoint exists; "it has been sent" is only true when the receipt says so, so the unknown case falls to the claim that cannot be wrong.

A build may ship a *default* destination: `BIBLE_DIAGNOSTICS_URL` is baked into `DIAGNOSTICS_DEFAULT_ENDPOINT` at build time, and `BIBLE_DIAGNOSTICS_TOKEN` into `DIAGNOSTICS_SHARED_TOKEN` (`electron.vite.config.ts` -> `electron/config/constants.ts`). Both default to empty, and a default endpoint changes nothing about consent: the uploader is still gated on `cfg.enabled`, which is still `false` until the user turns it on. A URL alone sends nothing.

### The reference receiver

`apps/web/server/routes/desktopReportRoutes.ts` implements this contract: `POST /api/desktop-report`, one JSON file per report under `<dataDir>/desktop-reports`, kept separate from the web app's own `/api/feedback` submissions. It records **no IP address in any privacy mode** - see [the web server API doc](../../../web/docs/features/server-api.md) - because the privacy blurb this app shows the user promises exactly that.

## Privacy Guarantees

**Always excluded** (enforced in payload builders and verified in unit tests):

- File paths - stack traces are scrubbed to replace `os.homedir()`, `/home/{user}`, `/Users/{user}`, and `C:\Users\{user}` with `~` or `<user>` before the stack enters the queue
- OS username / `USER` / `USERNAME` / `LOGNAME` env values - replaced with `<user>` in any outgoing string
- Timezone, locale, hostname - never collected
- Verse reading history, search queries, note content, module library, session names - never touched by the service
- IPC arguments - the breadcrumb ring stores channel name + timestamp only; the `safeArgs` field on `recordIpc` is accepted but intentionally dropped

**Crash cap:** at most `DIAGNOSTICS_CRASHES_PER_SESSION_CAP` (10) captures per session. A repeating error can't flood the queue or the upstream endpoint.

**Dedup:** identical `{message, first-5-stack-frames}` pairs are captured once per session.

**Consent gate:** crash payloads carry `pending_send: false` until the user clicks "Send Report" in the crash dialog, which flips the flag via `diagnostics:submit-crash-report`. The uploader refuses to send crash reports with `pending_send=false`. Manual and feedback reports are submitted intentionally so they are eligible immediately.

## Build ID & Source Maps

The `__BIBLE_BUILD_ID__` identifier is injected at build time by `electron.vite.config.ts` (via Vite's `define`) with the short git SHA of the source revision, and read back as `BUILD_ID` in `DiagnosticsService.ts`. When present it is attached to crash, manual and feedback payloads as `build_id` and to every upload as the `X-Build-Id` header. In dev builds (or when git is unavailable at build time) the constant is empty and the key is omitted from the payload entirely - never emitted as an empty string.

The desktop app ships minified production bundles, so raw stack frames reference compiled column offsets. The uploader does not resolve source maps client-side (that would either leak the map in the payload or require shipping it to every end user). The intended pattern is server-side resolution: the receiver matches `X-Build-Id` against a private map store and rewrites frames before persisting the report.
