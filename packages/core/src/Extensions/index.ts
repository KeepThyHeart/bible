/**
 * Barrel export for the `@bible/core` Extensions namespace.
 *
 * Re-exported from `packages/core/src/index.ts` under the `Extensions` alias
 * to avoid colliding with the existing `IBibleApi` / `ICommentaryApi` /
 * `IDictionaryApi` types in `@bible/core/Api/*` (those are the host's
 * internal IPC API contract; the Extensions namespace is the third-party
 * extension contract).
 *
 * Consumers:
 *
 *   import { Extensions } from '@bible/core';
 *   const v: Extensions.BibleVerseDto = ...;
 *   const api: Extensions.BibleExtensionAPI = ...;
 *
 * The version constant is also re-exported directly from the package root:
 *
 *   import { EXTENSION_API_VERSION } from '@bible/core';
 */

export * from './RpcEnvelope';
export * from './Permissions';
export * from './ActivationEvents';
export * from './ExtensionApiDtos';
export * from './ExtensionApiErrors';
export * from './ExtensionApiTypes';
export * from './ExtensionPointTypes';
export * from './ExtensionManifest';
export * from './ExtensionCatalog';
export * from './ExtensionManifestValidator';
export * from './IExtensionHost';
export * from './IExtensionRuntime';
