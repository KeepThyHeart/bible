import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface AppStageApp {
  id: string;
  active: boolean;
  view: ReactNode;
}

export interface AppStageProps {
  /** Every mounted app. Inactive ones stay mounted (state survives) but are hidden and inert. */
  apps: AppStageApp[];
  /** Shown (role=status) while `pendingId` is set and not among `apps`. */
  fallback?: ReactNode;
  pendingId?: string | null;
  /** Extra class per app wrapper. */
  appClassName?: (id: string) => string | undefined;
}

/** Keep-alive container. The active wrapper is `display: contents`, so the host layout is unchanged. */
export function AppStage({ apps, fallback, pendingId = null, appClassName }: AppStageProps) {
  const loading = pendingId !== null && !apps.some((a) => a.id === pendingId);
  return (
    <>
      {apps.map(({ id, active, view }) => (
        <StageApp key={id} id={id} active={active} className={appClassName?.(id)}>{view}</StageApp>
      ))}
      {loading && fallback !== undefined && fallback !== null && (
        <div className="kth-app-stage__status" role="status" aria-live="polite">{fallback}</div>
      )}
    </>
  );
}

interface StageAppProps { id: string; active: boolean; className?: string; children: ReactNode }

function StageApp({ id, active, className, children }: StageAppProps) {
  const ref = useRef<HTMLDivElement>(null);
  // `inert` is set as an attribute: React 18 drops the unknown boolean prop and preact would set the
  // (boolean) property from a string; the attribute works in both.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active) el.removeAttribute('inert');
    else el.setAttribute('inert', '');
  }, [active]);
  return (
    <div
      ref={ref}
      className={className ? `kth-app-stage__app ${className}` : 'kth-app-stage__app'}
      data-app={id}
      hidden={!active}
      aria-hidden={active ? undefined : 'true'}
    >
      {children}
    </div>
  );
}
