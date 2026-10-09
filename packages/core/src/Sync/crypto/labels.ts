/** Every HKDF info / AAD prefix used by sync (contracts 0063 §2). Never reuse a label for a second purpose. */
export const LABELS = {
  auth: 'kth-auth-v1',                    // master -> authKey (sent to server at login)
  kek: 'kth-kek-v1',                      // master -> KEK (wraps account key; never leaves client)
  recoveryWrap: 'kth-recovery-wrap-v1',   // recovery code -> wrapping key for the account key
  recoveryAuth: 'kth-recovery-auth-v1',   // recovery code -> recoveryAuthKey (server keeps its SHA-256)
  akWrap: 'kth-ak-wrap-v1',               // AAD prefix when wrapping the account key
  dkWrap: 'kth-dk-wrap-v1',               // AAD prefix when wrapping a data key under the account key
  idkWrap: 'kth-idk-wrap-v1',             // AAD prefix when wrapping the record-id key
  recordId: 'kth-recid-v1',               // HMAC domain for derived record ids
  record: 'kth-rec-v1',                   // AAD prefix of every record blob
  deviceName: 'kth-devname-v1',           // AAD prefix of encrypted device names
  backupAccountSlot: 'kth-backup-wrap-v1',// accountKey -> KEK of a .bbk "account" key slot (W4-C)
} as const;
