/**
 * Wave-0 stub helper (task 0150, C0). Every contract body throws through this until the package that owns it
 * implements it. It takes the stub's parameters only so `noUnusedParameters` accepts the contract's names.
 * Internal: not exported from `Sync/index.ts`. Delete the import when the last stub in a file is implemented.
 */
export function notImplemented(..._args: unknown[]): Error {
  return new Error('not implemented');
}
