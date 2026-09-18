/**
 * Smoke-test harness — hook enumeration + invocation primitives.
 *
 * Later work items (corpora, assertion engine, CLI, reporter) consume
 * this module's API; extension authors typically invoke the `smoke`
 * subcommand rather than these exports directly.
 */

export { loadManifest, ManifestLoadError, type LoadedManifest } from './loadManifest';
export { createRecordingApi, type RecordingApi } from './recordingApi';
export { enumerateHooks, INPUT_SHAPE_BY_KIND, type EnumerateOptions } from './enumerateHooks';
export {
  DEFAULT_CORPUS,
  DEFAULT_VERSE_ID_CORPUS,
  DEFAULT_VERSE_RANGE_CORPUS,
  DEFAULT_REFERENCE_STRING_CORPUS,
  DEFAULT_DICTIONARY_KEY_CORPUS,
  DEFAULT_SECTION_ID_CORPUS,
  DEFAULT_COMMAND_ARGS_CORPUS,
  DEFAULT_EVENT_PAYLOAD_CORPUS,
  DEFAULT_STORAGE_CORPUS,
  DEFAULT_NETWORK_CORPUS,
  DEFAULT_NONE_CORPUS,
  getCorpusForShape,
  getDefaultCorpus,
  mergeCorpus,
  validateUserCorpus,
  CorpusValidationError,
  type CorpusOverride,
  type NetworkFixture,
  type NetworkResponseKind,
  type SmokeCorpus,
  type StorageStateFixture,
  type UserCorpusFile,
} from './corpora';
export {
  InProcessHookInvoker,
  type HookInvoker,
  type InvokeOptions,
} from './hookInvoker';
export {
  createSmokeHarness,
  type SmokeHarness,
  type SmokeHarnessOptions,
} from './createSmokeHarness';
export type {
  CapturedRegistrations,
  HookDescriptor,
  HookInputShape,
  HookInvocationResult,
  HookInvocationStatus,
  HookKind,
  HookSource,
  HookTarget,
} from './types';
export {
  formatPretty,
  formatJson,
  SMOKE_JSON_SCHEMA_VERSION,
  type FormatPrettyOptions,
  type FormatJsonOptions,
  type SmokeJsonEnvelopeV1,
} from './reporters';
export {
  createRealmSmokeHarness,
  RealmHookInvoker,
  dispatchToApi,
  type DispatchResult,
  type RealmEndpointCaller,
  type RealmEndpointOutcome,
  type RealmFactory,
  type RealmRuntimeError,
  type RealmSession,
  type RealmSessionOptions,
  type RealmSmokeHarness,
  type RealmSmokeHarnessOptions,
} from './realm';
export {
  runSmokeSuite,
  declaredPermissions,
  type RunSmokeSuiteOptions,
  type ReturnValidator,
  type SmokeFailureReason,
  type SmokeHookSummary,
  type SmokeRecord,
  type SmokeRecordStatus,
  type SmokeSuiteResult,
  type SmokeSuiteTotals,
} from './runSmokeSuite';
