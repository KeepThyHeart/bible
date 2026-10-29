import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { getClientConfig } from '../utils/clientConfig';
import { contrastText, dismissedBannerIds, parseBanners, pickText, rememberDismissed } from '../utils/siteBanners';

/** The operator's banners (site-config `banners`) as strips at the top of the app. Text only, never HTML. */
export function SiteBanners() {
  const { t, i18n } = useTranslation();
  const [dismissed, setDismissed] = useState<string[]>(dismissedBannerIds);
  const banners = parseBanners(getClientConfig().banners).filter((b) => !(b.dismissible && dismissed.includes(b.id)));
  if (!banners.length) return null;
  const lang = i18n.language || 'en';

  return (
    <div class="site-banners">
      {banners.map((b) => {
        const bg = b.color;
        const fg = b.textColor ?? contrastText(bg);
        return (
          <div key={b.id} class="site-banner" role="status" style={bg ? { background: bg, color: fg } : b.textColor ? { color: b.textColor } : undefined}>
            <span class="site-banner__message">{pickText(b.message, lang)}</span>
            {b.link && (
              <a class="site-banner__link" href={b.link.url} target={b.link.url.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer" style={{ color: 'inherit' }}>
                {pickText(b.link.label, lang)}
              </a>
            )}
            {b.dismissible && (
              <button
                class="site-banner__dismiss"
                title={t('connectionBanner.dismiss')}
                onClick={() => {
                  rememberDismissed(b.id);
                  setDismissed((d) => [...d, b.id]);
                }}
              >
                <i class="fa-solid fa-xmark" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
