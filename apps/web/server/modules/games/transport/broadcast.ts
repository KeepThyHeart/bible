/**
 * Running an intent and telling everyone what happened.
 *
 * The important line in this file is the one inside the loop: each subscriber
 * is projected separately and receives its own payload. There is deliberately
 * no "render once, write to everyone" fast path, because that single shared
 * payload is exactly how a player's score, rank or wrong answer ends up on the
 * big screen. Privacy here is structural — the data for a bottom of the
 * leaderboard is never assembled, so no client bug can render one.
 */

import type { Room, RoomRegistry } from './RoomRegistry.js';
import type { Subscriber } from './EventStream.js';
import type { EffectHandlers, RoomPort } from './roomPort.js';
import type { AddressedIntent, Effect, ServerTime } from '../../../../src/modules/games/shared/protocol.js';

export interface TransportContext {
  port: RoomPort;
  registry: RoomRegistry;
  handlers: EffectHandlers;
  now: () => ServerTime;
}

/** One subscriber's own view of the room, or nothing if it is no longer theirs. */
export function sendSnapshot(context: TransportContext, room: Room, subscriber: Subscriber): void {
  if (subscriber.role.kind === 'screen') {
    const snapshot = context.port.projectForScreen(room.state, subscriber.role.owner);
    subscriber.send({ type: 'snapshot', snapshot });
    return;
  }

  const snapshot = context.port.projectForPlayer(room.state, subscriber.role.playerId);
  if (snapshot === null) {
    // The room no longer has this player, so there is nothing to project.
    // Saying so and closing beats leaving a phone rendering a stale roster.
    subscriber.send({ type: 'kicked', reason: 'You are no longer in this room.' });
    subscriber.close();
    room.subscribers.delete(subscriber);
    return;
  }
  subscriber.send({ type: 'snapshot', snapshot });
}

export function broadcast(context: TransportContext, room: Room): void {
  if (room.closed) return;
  // Copied first: a projection that returns null closes a stream and removes
  // it from this very set.
  for (const subscriber of [...room.subscribers]) {
    if (subscriber.closed) {
      room.subscribers.delete(subscriber);
      continue;
    }
    sendSnapshot(context, room, subscriber);
  }
}

/**
 * The full leaderboard, to the controller only, as a one-off. It is not part
 * of steady state on purpose: the controller asks for it in the moment they
 * need to adjust a score, and it never becomes something every screen is
 * rendering by default — nor, now that control can be a phone's, something
 * every screen is even entitled to.
 */
export function sendFullStandings(context: TransportContext, room: Room): void {
  const standings = context.port.standingsFull?.(room.state);
  if (standings === undefined) return;
  for (const subscriber of room.subscribers) {
    if (!isController(context, room, subscriber)) continue;
    subscriber.send({ type: 'standingsFull', standings });
  }
}

/**
 * Whether this subscriber is the room's current controller. Read from the
 * same `controller` field every snapshot already carries, rather than from
 * state directly — state stays opaque to the transport even here. A
 * display-credentialled screen is never the controller, whatever else is
 * happening in the room.
 */
function isController(context: TransportContext, room: Room, subscriber: Subscriber): boolean {
  if (subscriber.role.kind === 'screen') {
    if (!subscriber.role.owner) return false;
    return context.port.projectForScreen(room.state, true).controller.kind === 'owner';
  }
  const snapshot = context.port.projectForPlayer(room.state, subscriber.role.playerId);
  return (
    snapshot !== null &&
    snapshot.controller.kind === 'player' &&
    snapshot.controller.playerId === subscriber.role.playerId
  );
}

/**
 * The two halves of a reveal, addressed separately.
 *
 * The public payload is unattributed by construction and goes to everyone. A
 * personal result is assembled per socket and reaches nobody else, which is the
 * same rule the snapshots follow and for the same reason: a wrong answer is
 * private, and the way to keep it private is not to render it anywhere it could
 * be sent to the wrong person.
 */
export function sendReveal(context: TransportContext, room: Room, round: number): void {
  const reveal = context.port.projectReveal(room.state);
  // A round with no outcome — skipped, or abandoned before it was scored — has
  // nothing to reveal, and a payload for a different round is one the room has
  // already moved past.
  if (reveal === null || reveal.round !== round) return;

  for (const subscriber of [...room.subscribers]) {
    if (subscriber.closed) continue;
    if (subscriber.role.kind === 'screen') {
      subscriber.send({ type: 'reveal', reveal, yourResult: null });
      continue;
    }
    const yourResult = context.port.projectPersonalResult(room.state, subscriber.role.playerId);
    subscriber.send({ type: 'reveal', reveal, yourResult });
  }
}

/**
 * Run one authenticated intent: reduce, perform the effects the reducer asked
 * for, then broadcast. Effects are performed before the broadcast so that a
 * snapshot never advertises a deadline whose timer has not been armed yet.
 */
export function dispatch(context: TransportContext, room: Room, addressed: AddressedIntent): void {
  if (room.closed) return;

  const result = context.port.reduce(room.state, addressed);
  room.state = result.state;
  context.registry.touch(room);

  for (const effect of result.effects) applyEffect(context, room, effect);

  // The owner or the controlling player alike may ask; `sendFullStandings`
  // itself decides who, if anyone currently subscribed, is entitled to the
  // answer (the reducer already refused the command's own effect on state
  // if the asker was neither).
  if (addressed.intent.kind === 'host' && addressed.intent.command.cmd === 'requestFullStandings') {
    sendFullStandings(context, room);
  }

  broadcast(context, room);

  // After the broadcast, so that the snapshot announcing the reveal phase has
  // already arrived: a phone is never handed a result for a phase it is not in
  // yet.
  for (const effect of result.effects) {
    if (effect.type === 'reveal') sendReveal(context, room, effect.round);
  }
}

/**
 * The reducer never calls `setTimeout`; it asks for a wake-up at an absolute
 * server time, and the room's scheduler arms it and hands it back as an
 * ordinary intent. A timing bug is then reproducible by feeding intents in
 * order with no clock involved at all.
 */
function applyEffect(context: TransportContext, room: Room, effect: Effect): void {
  switch (effect.type) {
    case 'timer':
      room.scheduler.schedule(effect.at, effect.round, effect.tag);
      return;
    case 'cancelTimers':
      context.registry.cancelTimers(room, effect.round);
      return;
    case 'persist':
      context.handlers.persist?.(room.code, room.state);
      return;
    case 'requestJudge':
      context.handlers.requestJudge?.(room.code, effect.round, effect.playerId);
      return;
    case 'reveal':
      // Deliberately nothing here: a reveal is sent after the broadcast rather
      // than before it. See `dispatch`.
      return;
    case 'closeRoom':
      context.registry.close(room, 'the host ended the game');
      return;
    // The room already removed this player from its own roster; this is the
    // half only the transport can do — invalidating the token and the clock
    // measurement that belonged to them. Performed here, like every other
    // effect, rather than the caller inferring it from the intent it
    // dispatched: a refused kick reaches here as no effect at all.
    case 'removeSession':
      context.registry.removeSession(room, effect.playerId);
      return;
  }
}
