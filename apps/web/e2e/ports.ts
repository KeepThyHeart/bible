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
