/**
 * The client half of the clock layer: measure the offset once, share it, and
 * convert every server instant through it so that all the screens on one phone
 * agree with each other and with the room.
 */

export { ClockSync, getClock, setClock, sampleFrom, bestSample } from './offset.js';
export type { ClockSample, ClockEstimate, ClockReport, ClockReader, ClockSyncOptions } from './offset.js';

export { showAt, serverNow, msUntil } from './showAt.js';
export type { CancelScheduled, ShowAtOptions } from './showAt.js';
