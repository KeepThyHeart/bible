/**
 * Re-export of the shared reducer.
 *
 * The reducer moved to `src/present/reducer.ts` so a client can apply the same
 * transition a server would (see that file's header). This shim keeps every
 * existing server import (`../present/reducer.js`) working unchanged.
 */
export * from '../../src/present/reducer.js';
