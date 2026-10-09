/**
 * End-to-end encrypted sync (task 0063 design, built in task 0150). Browser-safe: no Node imports and nothing runs
 * at module load. Exposed as the `Sync` namespace from both core barrels (`export * as Sync from './Sync'`).
 * Explicit names only, so a new export in one file cannot silently collide with another.
 */
export type {
  HexId, AccountId, RecordId, DeviceId, HlcString, RecordType, RecordPlaintext, EncryptedRecord, KdfParamsJson,
} from './types';
/** Re-exported for the hosts of Sync (web user-DB worker), which reach core only through `@bible/core/browser`. */
export type { ISql, SqlParameter, SqlRow, SqlResult } from '../Data/Core/ISql';

// crypto
export { LABELS } from './crypto/labels';
export type { PasswordKeys, UnlockedAccount, WrappedKey, KeysetWire, AccountKeyMaterial } from './crypto/keys';
export {
  derivePasswordKeys, createAccountMaterial, unlockWithPassword, unlockWithRecoveryCode, rewrapForNewPassword,
  newRecoveryWrap, rotateAccountKey, generateRecoveryCode, parseRecoveryCode, deriveRecordId, sealDeviceName,
  openDeviceName, validateKdfParams,
} from './crypto/keys';
export type { RecordCipher } from './crypto/RecordCipher';
export {
  RECORD_BLOB_VERSION, MAX_RECORD_JSON, RecordTooLargeError, UnknownEpochError, createRecordCipher,
} from './crypto/RecordCipher';

// tracking
export type { HlcClock } from './tracking/Hlc';
export { createHlc, compareHlc, parseHlc } from './tracking/Hlc';
export type { TrackedTable, DirtyRow, ChangeTracker } from './tracking/ChangeTracker';
export { createChangeTracker, coreTrackedTables } from './tracking/ChangeTracker';

// codecs and merge
export type {
  ModuleRefResolver, CodecContext, DecodeResult, RecordCodec, CodecRegistry,
} from './codecs/RecordCodec';
export { createCoreCodecs, createCodecRegistry } from './codecs/RecordCodec';
export type { Version, MergeOutcome, MergePolicy } from './merge/MergePolicy';
export { lwwPolicy, fieldLwwWithBodyCopy, policyFor, keyBetween } from './merge/MergePolicy';

// server API
export { SYNC_API_PREFIX, LIMITS } from './api';
export type {
  ApiError, ApiErrorCode, InfoResponse, DeviceWire, PreloginRequest, PreloginResponse, SignupRequest, SessionResponse,
  LoginRequest, RecoverRequest, VerifyEmailRequest, ResetRequest, ResetConfirmRequest, KeysRequest, PullResponse,
  EncryptedRecordWire, PushRecord, PushRequest, PushResponse, AccountResponse, DevicesResponse, DeleteAccountRequest,
  ServerExport,
} from './api';

// engine
export type { ISecretStore, SecretName } from './engine/ISecretStore';
export { serializeUnlocked, deserializeUnlocked, MemorySecretStore } from './engine/ISecretStore';
export type { ISyncTransport, HttpClientOptions } from './engine/ISyncTransport';
export { SyncHttpError } from './engine/ISyncTransport';
export { SyncApiClient } from './engine/SyncApiClient';
export type { SyncStatus, SyncStatusStore } from './engine/SyncStatus';
export { createSyncStatusStore } from './engine/SyncStatus';
export type { SyncEngineOptions, SyncAdapter, SyncResult, SyncScheduler } from './engine/SyncEngine';
export { SyncEngine } from './engine/SyncEngine';

// account
export type { AccountClientDeps } from './account/AccountClient';
export { AccountClient, WeakPasswordError } from './account/AccountClient';
export { passwordStrength } from './password';
