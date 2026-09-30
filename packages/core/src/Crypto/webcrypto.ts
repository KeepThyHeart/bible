/**
 * Typing shim for WebCrypto inputs.
 *
 * Depending on the TypeScript version and `lib` in use (core builds without the
 * DOM lib; the desktop and web apps compile core's source with it), a plain
 * `Uint8Array` is or is not assignable to `BufferSource`. At runtime every
 * WebCrypto implementation accepts typed-array views, so this narrows the type
 * once instead of casting at each call.
 */
export const asBufferSource = (u: Uint8Array): ArrayBuffer => u as unknown as ArrayBuffer;
