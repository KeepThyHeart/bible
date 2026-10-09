/** Typed wrapper for every route in api.ts (contracts 0063 §8; W3-A implements). */
import type { DeviceId } from '../types';
import type {
  AccountResponse, DeleteAccountRequest, DevicesResponse, InfoResponse, KeysRequest, LoginRequest, PreloginRequest,
  PreloginResponse, RecoverRequest, ResetConfirmRequest, ResetRequest, ServerExport, SessionResponse, SignupRequest,
  VerifyEmailRequest,
} from '../api';
import type { HttpClientOptions, ISyncTransport } from './ISyncTransport';
import { notImplemented } from '../notImplemented';

export class SyncApiClient {
  constructor(o: HttpClientOptions) {
    throw notImplemented(o);
  }
  info(): Promise<InfoResponse> { throw notImplemented(); }
  prelogin(r: PreloginRequest): Promise<PreloginResponse> { throw notImplemented(r); }
  signup(r: SignupRequest): Promise<SessionResponse> { throw notImplemented(r); }
  login(r: LoginRequest): Promise<SessionResponse> { throw notImplemented(r); }
  recover(r: RecoverRequest): Promise<SessionResponse> { throw notImplemented(r); }
  logout(): Promise<void> { throw notImplemented(); }
  verifyEmail(r: VerifyEmailRequest): Promise<void> { throw notImplemented(r); }
  reset(r: ResetRequest): Promise<void> { throw notImplemented(r); }
  resetConfirm(r: ResetConfirmRequest): Promise<SessionResponse> { throw notImplemented(r); }
  account(): Promise<AccountResponse> { throw notImplemented(); }
  keys(r: KeysRequest): Promise<void> { throw notImplemented(r); }
  devices(): Promise<DevicesResponse> { throw notImplemented(); }
  revokeDevice(id: DeviceId): Promise<void> { throw notImplemented(id); }
  exportAll(): Promise<ServerExport> { throw notImplemented(); }
  deleteAccount(r: DeleteAccountRequest): Promise<void> { throw notImplemented(r); }
  transport(): ISyncTransport { throw notImplemented(); }
}
