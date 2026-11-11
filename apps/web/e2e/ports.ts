/**
 * Ports for the two servers the suite starts. `E2E_PORT` moves the pair, so two
 * checkouts can run e2e at once: the plain server takes the base port, the
 * PWA-enabled one takes base + 1. Default 3100 / 3101.
 */
const parsed = Number.parseInt(process.env.E2E_PORT ?? '', 10);
export const E2E_PORT = Number.isInteger(parsed) && parsed > 0 && parsed < 65535 ? parsed : 3100;
export const E2E_PWA_PORT = E2E_PORT + 1;
export const PLAIN_URL = `http://localhost:${E2E_PORT}`;
export const PWA_URL = `http://localhost:${E2E_PWA_PORT}`;

/**
 * Third server: `features.localUserDb` + `features.accounts` on, console mailer, its own data and state
 * directories (see `prepareAccountsData` in prepareData.ts). Base port + 2.
 */
export const E2E_ACCOUNTS_PORT = E2E_PORT + 2;
export const ACCOUNTS_URL = `http://localhost:${E2E_ACCOUNTS_PORT}`;
/** `e2e/.data/accounts-<port>`: holds main.db + site-config.json (BIBLE_DATA_DIR) and `state/` (BIBLE_APP_STATE_DIR). */
export const ACCOUNTS_DIR = `${import.meta.dirname}/.data/accounts-${E2E_ACCOUNTS_PORT}`;
/** Everything the accounts server prints (the console mailer's links included), written by serverWithLog.mjs. */
export const ACCOUNTS_SERVER_LOG = `${ACCOUNTS_DIR}/state/stdout.log`;
