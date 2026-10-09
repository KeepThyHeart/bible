import { Suspense, lazy } from 'preact/compat';
import type { ComponentType } from 'preact';
import { modulePoints } from '../moduleHost';
import type { PaneViewProps } from './panes';

const lazyPanes = new Map<unknown, ComponentType<PaneViewProps>>();

/** A pane that is not eager: its `pane:<id>` view loader, wrapped once in a lazy component. */
export function LazyPane({ id, props }: { id: string; props: PaneViewProps }) {
  const loader = modulePoints.views.resolve<{ default: ComponentType<PaneViewProps> }>(`pane:${id}`);
  if (!loader) return null;
  let Comp = lazyPanes.get(loader);
  if (!Comp) {
    Comp = lazy(loader) as ComponentType<PaneViewProps>;
    lazyPanes.set(loader, Comp);
  }
  return (
    <Suspense fallback={null}>
      <Comp {...props} />
    </Suspense>
  );
}
