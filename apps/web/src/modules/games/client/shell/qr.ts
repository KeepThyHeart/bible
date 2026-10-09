/**
 * QR rendering, isolated in its own module so it can be code-split.
 *
 * Only the host screen ever draws one, and the host screen is the one device in
 * the room that is not a phone on cellular data — so the encoder is loaded on
 * demand rather than shipped to everybody.
 *
 * SVG rather than a canvas or a data URL: it stays sharp on a projector at any
 * size, and it costs no pixels to scale.
 */

import { qrSvg as encodeSvg } from '../../../present/lib/qr';

export async function qrSvg(text: string): Promise<string> {
  // The app's own encoder (no network, no npm dependency). A light quiet zone
  // of 2 modules keeps the code large on a projector; scanners cope with it.
  return encodeSvg(text, { quietZone: 2, dark: '#000000', light: '#ffffff' });
}
