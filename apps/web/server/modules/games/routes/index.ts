import { Router } from 'express';
import { API, API_BASE } from '../../../../src/modules/games/shared/protocol.js';
import type {
  Catalog,
  CatalogGame,
  CatalogSet,
  TimeSyncRequest,
  TimeSyncResponse,
} from '../../../../src/modules/games/shared/protocol.js';
import { catalogEntryFor } from '../../../../src/modules/games/shared/games.js';
import { content } from '../content/index.js';
import { emptyGame, games } from '../games/index.js';
import { createJudgeProvider } from '../judge/index.js';
import { config } from '../config.js';
import type { PrivacyMode } from '../../../SiteConfig.js';
import { createRoomPort } from '../room/port.js';
import { dispatch } from '../transport/broadcast.js';
import type { EffectHandlers } from '../transport/roomPort.js';
import { createTransport } from '../transport/routes.js';

/**
 * Route registration.
 *
 * This is the one file that knows all three layers exist. The transport is
 * handed a room port and nothing else; the catalog reads the content layer and
 * the game registry and nothing else. Neither layer imports the other, which is
 * why either can be replaced here without the other noticing.
 */
/** Paths in `API` are absolute; the router is mounted at `API_BASE`, so it matches the rest. */
const rel = (path: string): string => path.slice(API_BASE.length);

export function createGamesRouter(options: { privacyMode?: PrivacyMode } = {}): Router {
  const app = Router();

  app.post(rel(API.time), (req, res) => {
    const body = req.body as Partial<TimeSyncRequest>;
    const response: TimeSyncResponse = {
      t0: typeof body.t0 === 'number' ? body.t0 : 0,
      tServer: Date.now(),
    };
    res.json(response);
  });

  /**
   * What a host may pick from. Empty lists are a legitimate answer — a fresh
   * checkout has no Bible module installed and no game modules written — and
   * the host screen says so rather than failing to load.
   */
  app.get(rel(API.catalog), (_req, res) => {
    const library = content();
    const catalogGames: CatalogGame[] = games.list().map(catalogEntryFor);
    // A question set is authored against content, not against one game, so
    // nothing here can honestly claim which game it belongs to.
    const sets: CatalogSet[] = library.questionSets().map((set) => ({
      id: set.id,
      name: set.name,
      gameId: null,
    }));
    const catalog: Catalog = {
      games: catalogGames,
      sets,
      translations: library.translations().map((summary) => summary.abbreviation),
    };
    res.json(catalog);
  });

  // Where the fallback lives: a host may name a game this build does not
  // carry, and refusing to open the room would strand a group that is already
  // in the same physical space. They get the stand-in and a screen that says so.
  const port = createRoomPort((settings) => games.get(settings.gameId) ?? emptyGame);

  // Filled in below rather than at construction, because the handler needs the
  // transport it is being handed to. The transport keeps this object, so the
  // later assignment is the one it sees.
  const handlers: EffectHandlers = {};
  const transport = createTransport({ port, handlers });

  const judge = createJudgeProvider(config.judge, { privacyMode: options.privacyMode });

  /**
   * A suggestion, arriving whenever it arrives. Three things are re-checked at
   * the moment it comes back rather than assumed from when it was asked for:
   * the room still exists, it is not closed, and the request still concerns the
   * same player. A model is slow enough that a host can adjudicate and the
   * queue can move on while it thinks, and a verdict landing on whoever happens
   * to be at the head of the queue by then would be worse than no verdict.
   */
  handlers.requestJudge = (code, round, playerId) => {
    const room = transport.registry.get(code);
    if (room === undefined) return;
    const request = port.judgeRequest?.(room.state) ?? null;
    if (request === null || request.playerId !== playerId) return;

    void judge.suggest(request).then((suggestion) => {
      // No suggestion is the ordinary case, not a failure: the null provider is
      // the default, and the host has the same two buttons either way.
      if (suggestion === null) return;
      const current = transport.registry.get(code);
      if (current === undefined || current.closed) return;
      dispatch(transport.context, current, {
        actor: { role: 'system' },
        intent: { kind: 'judgeSuggestion', round, playerId, suggestion },
        receivedAt: Date.now(),
      });
    });
  };

  transport.register(app, API_BASE);
  return app;
}
