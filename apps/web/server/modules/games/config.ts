import { resolve } from 'node:path';

/**
 * Runtime configuration for the games module.
 *
 * Defaults are read from the environment at import; the host then calls
 * `configureGames` with the directories it owns (Bible text now comes from the
 * host's `DatabaseManager`, not a modules directory of the games' own).
 */

const env = process.env;

const isProduction = env.NODE_ENV === 'production';

export interface Config {
  port: number;
  /**
   * Which interfaces to accept connections on. Production defaults to loopback,
   * because the only thing that should reach the Node process is the reverse
   * proxy: binding every interface there publishes an unencrypted copy of the
   * whole site on a high port and quietly bypasses TLS for anyone who finds it.
   * Development defaults to every interface for the opposite reason — testing
   * this project at all means phones on the same network reaching a laptop.
   */
  bindAddress: string;
  /** Directory holding `*.db` Bible modules. */
  moduleDir: string;
  /** Where room persistence and generated content live. */
  dataDir: string;
  /** Default translation abbreviation, matched against a module's own metadata. */
  defaultTranslation: string;
  /** How long a room survives with nobody connected. */
  roomIdleTimeoutMs: number;
  /** Set to enable judging suggestions; absent means the null provider. */
  judge: JudgeConfig | null;
  isProduction: boolean;
}

export interface JudgeConfig {
  /** OpenAI-shaped chat-completions endpoint. */
  baseUrl: string;
  apiKey: string;
  model: string;
}

function readJudgeConfig(): JudgeConfig | null {
  const apiKey = env.BIBLE_GAMES_JUDGE_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: env.BIBLE_GAMES_JUDGE_BASE_URL ?? 'https://api.together.xyz/v1',
    apiKey,
    model: env.BIBLE_GAMES_JUDGE_MODEL ?? 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  };
}

const initial: Config = {
  port: Number(env.PORT ?? 3030),
  bindAddress: env.BIBLE_GAMES_BIND ?? (isProduction ? '127.0.0.1' : '0.0.0.0'),
  moduleDir: resolve(env.BIBLE_GAMES_MODULE_DIR ?? 'modules'),
  dataDir: resolve(env.BIBLE_GAMES_DATA_DIR ?? 'data'),
  defaultTranslation: env.BIBLE_GAMES_TRANSLATION ?? 'KJV',
  roomIdleTimeoutMs: Number(env.BIBLE_GAMES_ROOM_TIMEOUT_MS ?? 2 * 60 * 60 * 1000),
  judge: readJudgeConfig(),
  isProduction,
};

/** The live configuration. Mutated in place by `configureGames`, so importers see the update. */
export const config: Config = initial;

/** Override parts of the configuration (called once by the route factory; tests may too). */
export function configureGames(overrides: Partial<Config>): void {
  Object.assign(config, overrides);
}
