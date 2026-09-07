/// <reference types="vite/client" />

/** Build identifier injected by vite.config.ts; compared against /api/version on boot. */
declare const __BUILD_ID__: string;

/**
 * Whether this build shipped a service worker and web app manifest. Injected by
 * vite.config.ts from `ENABLE_PWA`; false unless explicitly opted in.
 */
declare const __PWA_ENABLED__: boolean;

declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: any) => void;
  }): (reloadPage?: boolean) => Promise<void>;
}

declare module 'wa-sqlite/dist/wa-sqlite-async.mjs' {
  export default function SQLiteESMFactory(): Promise<any>;
}

declare module 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js' {
  import type { SQLiteVFS } from 'wa-sqlite';
  export class OriginPrivateFileSystemVFS implements SQLiteVFS {
    readonly name: string;
    close(): Promise<void>;
    xOpen(name: string | null, fileId: number, flags: number, pOutFlags: DataView): number;
    xClose(fileId: number): number;
    xRead(fileId: number, pData: Uint8Array, iOffset: number): number;
    xWrite(fileId: number, pData: Uint8Array, iOffset: number): number;
    xTruncate(fileId: number, iSize: number): number;
    xSync(fileId: number, flags: number): number;
    xFileSize(fileId: number, pSize64: DataView): number;
    xLock(fileId: number, flags: number): number;
    xUnlock(fileId: number, flags: number): number;
    xCheckReservedLock(fileId: number, pResOut: DataView): number;
    xFileControl(fileId: number, flags: number, pOut: DataView): number;
    xDeviceCharacteristics(fileId: number): number;
    xDelete(name: string, syncDir: number): number;
    xAccess(name: string, flags: number, pResOut: DataView): number;
  }
}