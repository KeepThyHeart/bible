/**
 * The join QR on the host screen.
 *
 * It is a convenience, never the only way in: the code is printed beside it in
 * large type because half a room will type it and because a camera pointed at
 * a projector does not always cooperate.
 */

import { useEffect, useState } from 'preact/hooks';

export interface QrCodeProps {
  url: string;
  label: string;
}

/**
 * A loopback host is only ever reachable from the machine running the
 * server — a phone scanning it gets nothing. This is a development-only
 * mistake (a real deployment answers on its own address), so the fix is a
 * word of warning, not a validation error.
 */
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export function QrCode({ url, label }: QrCodeProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const loopback = isLoopback(url);

  useEffect(() => {
    let live = true;
    setSvg(null);
    // Loaded on demand: only this screen needs an encoder.
    void import('./qr.js')
      .then((module) => module.qrSvg(url))
      .then((markup) => {
        if (live) setSvg(markup);
      })
      .catch(() => {
        // No QR is a small loss next to the code printed beside it.
        if (live) setSvg(null);
      });
    return () => {
      live = false;
    };
  }, [url]);

  return (
    <div class="qr-block">
      <div class="qr" role="img" aria-label={label}>
        {svg === null ? (
          <div class="qr-empty" aria-hidden="true" />
        ) : (
          <div class="qr-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </div>
      {loopback && (
        <p class="qr-warning" role="note">
          This address only works on this computer — a phone will not be
          able to reach it. Fine for testing; a real room needs the
          server’s actual address.
        </p>
      )}
    </div>
  );
}
