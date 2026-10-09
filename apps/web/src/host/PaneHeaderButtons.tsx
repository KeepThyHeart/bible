import { useTranslation } from 'react-i18next';
import { usePaneModes } from '../modules/host/usePaneModes';
import { resolveLabel, renderAppIcon } from './appNavEntries';
import { openPane } from './paneRequests';

/**
 * One button per enabled pane mode that declares a `headerButton` (the header
 * and the phone landscape sidebar render this). Clicking opens the pane
 * (right pane on desktop, full-screen view on the phone).
 */
export function PaneHeaderButtons({ className }: { className: string }) {
  const { t } = useTranslation();
  const panes = usePaneModes().filter((m) => m.headerButton);
  if (panes.length === 0) return null;
  return (
    <>
      {panes.map((m) => (
        <button
          key={m.id}
          class={className}
          onClick={() => openPane(m.id)}
          title={resolveLabel((k, f) => t(k, f), m.headerButton!.title)}
          data-testid={m.headerButton!.testId}
        >
          {m.icon ? renderAppIcon(m.icon) : null}
        </button>
      ))}
    </>
  );
}
