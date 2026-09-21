/**
 * Asar probe extension - E2E fixture for `e2e/tests/extension-host-asar.spec.ts`.
 *
 * The fixture runs inside a QuickJS realm with no `require`, no `process` and
 * no filesystem, and reports what it *cannot* reach. The probe results
 * travel out over `console.log`, which the supervisor forwards to the host as a
 * `__runtime.log` event; the test reads them back with `extensions:getLog`.
 * There is deliberately no other way out: an extension that could still write
 * its findings to disk would be the bug.
 *
 * What the test infers from a successful run:
 *
 *   - the utilityProcess forked `out/main/extension-runtime/index.js` from
 *     *inside* `app.asar` and that script ran;
 *   - it instantiated the QuickJS WASM module and built a realm;
 *   - the extension's own bundle was read off disk, resolved against its
 *     install directory, and evaluated in that realm;
 *   - RPC round-trips host -> worker -> realm and back.
 *
 * Note `exports.activate = ...` rather than `export function activate`. The
 * realm loads the entry as CommonJS through a `(exports, module, require)`
 * wrapper - ESM syntax is a parse error here.
 */

/** Marks lines the test greps for in `extension.log`. */
var PROBE_TAG = 'ASAR_PROBE';
var RPC_TAG = 'ASAR_PROBE_RPC';

function probeAmbientAuthority() {
  var result = {};

  // The headline: outside the realm this call hands back the real `fs`.
  try {
    require('fs');
    result.require = 'ALLOWED';
  } catch (err) {
    result.require = 'denied';
    result.requireError = err && err.message ? err.message : String(err);
  }

  // Everything else an extension might reach for to escape the realm.
  result.typeofProcess = typeof process;
  result.typeofFetch = typeof fetch;
  result.typeofBuffer = typeof Buffer;
  result.typeofXHR = typeof XMLHttpRequest;
  result.typeofWebAssembly = typeof WebAssembly;

  // `Function('return this')()` is the classic realm escape. It must yield the
  // realm's own global, not the host's.
  try {
    var g = Function('return this')();
    result.escapedGlobalHasProcess = typeof g.process !== 'undefined';
    result.escapedGlobalHasRequire = typeof g.require !== 'undefined';
  } catch (err) {
    result.escapeError = err && err.message ? err.message : String(err);
  }

  // Proof that the ordinary language is intact - a realm that denied
  // everything by breaking JavaScript would not be useful.
  result.dateWorks = typeof Date.now() === 'number';
  result.jsonWorks = JSON.stringify({ ok: true }) === '{"ok":true}';

  return result;
}

exports.activate = function activate(api) {
  console.log(PROBE_TAG + ' ' + JSON.stringify(probeAmbientAuthority()));

  // Deferred so it runs after activate() has returned. Awaiting a host call
  // inside activate() is supported (see `bootstrap.ts`), but keeping this on
  // the post-activate path preserves what the original fixture covered.
  //
  // The KV tier is gated on the `storage` permission, and sideloading grants
  // only DEFAULT_GRANTED_PERMISSIONS - the spec grants `storage` over IPC once
  // the host has registered us. That grant can land either side of this code
  // (`onStartup` may have activated us during boot), so retry through the
  // denial instead of racing it. Only the settled outcome is logged, so the
  // marker the spec reads is never ambiguous.
  var attempt = 0;
  function roundTrip() {
    attempt++;
    Promise.resolve(api.storage.set('asarProbe', 'round-trip-ok'))
      .then(function () {
        return api.storage.get('asarProbe');
      })
      .then(
        function (value) {
          console.log(RPC_TAG + ' ' + JSON.stringify({ ok: true, value: value, attempts: attempt }));
        },
        function (err) {
          var message = err && err.message ? err.message : String(err);
          var denied = (err && err.code === 'PermissionDeniedError') || /permission/i.test(message);
          if (denied && attempt < 40) {
            setTimeout(roundTrip, 250);
            return;
          }
          console.log(
            RPC_TAG + ' ' + JSON.stringify({ ok: false, error: message, attempts: attempt }),
          );
        },
      );
  }
  setTimeout(roundTrip, 300);
};

exports.deactivate = function deactivate() {
  console.log(PROBE_TAG + ' ' + JSON.stringify({ stage: 'deactivate' }));
};
