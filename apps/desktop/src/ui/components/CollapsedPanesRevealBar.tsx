import React from 'react';
import { useI18n } from '../contexts/useI18n';
import type { CollapsedGroup } from '../services/PresetApplier';

interface CollapsedPanesRevealBarProps {
  /**
   * Groups currently squeezed to zero width - either by a layout preset
   * (Reading Mode) or by the user collapsing one from its group header.
   */
  collapsedGroups: CollapsedGroup[];
  /**
   * Titles of the panes hidden inside those groups, when cheaply available
   * (dockview's live group/panel data). Empty when the layout hasn't loaded
   * that far yet, or the groups no longer resolve - the bar still renders,
   * just with a generic label instead of naming the panes.
   */
  hiddenTitles: string[];
  /** Same handler the horizontal "Show hidden panes" header button uses. */
  onExpand: () => void;
}

/**
 * Vertical reveal tab pinned to the right edge of the dockview workbench.
 *
 * Reading Mode collapses the study group to zero width (see
 * `presets/readingMode.ts`), which leaves it unable to render any restore
 * control of its own. `DockviewHeaderActions` already offers a horizontal
 * "<< Show hidden panes" text button in the *other* group's header, but that
 * only appears once a pane is visible and focused there - it's easy to miss,
 * especially with the study side gone entirely. This bar mirrors the web
 * app's collapsed-commentary affordance (`CommentaryPane`'s
 * `commentary-pane--collapsed` / `__expand-btn`): a persistent sliver of
 * chrome at the outer edge, always in the same place, with rotated text
 * naming what's hidden.
 *
 * Both controls are kept deliberately (see DockviewLayout.tsx) - they live in
 * different places (inline in a pane's tab row vs. fixed outer chrome) and
 * read as complementary affordances rather than a duplicated control.
 *
 * IN NORMAL FLOW, NOT OVERLAID. `absolute inset-y-0 right-0` over the
 * workbench would leave DockviewReact occupying the full width underneath:
 * the visible panes would run *under* the rail, their right-hand content
 * (scrollbars, the collapse chevron, the last few characters of a line)
 * hidden behind a translucent sliver. It is a real flex sibling of the
 * dockview container instead - exactly how the web app does it
 * (`.main-layout` in apps/web/src/styles/_layout.scss makes the collapsed
 * commentary rail a flex child, which is precisely why nothing extends under
 * it there) - and its background is opaque for the same reason.
 *
 * PHYSICAL, NOT LOGICAL, PLACEMENT - do not "fix" this to `borderInlineStart`,
 * and do not reorder it in the DOM. This bar has to sit against the same edge
 * as the collapsed group, and dockview's grid geometry never mirrors for RTL:
 * its splitview positions every view with a JS-computed physical `left`, so
 * panel order stays left-to-right even under `dir="rtl"` (the reasoning is
 * spelled out in the RTL section of styles/dockview-overrides.css). The
 * workbench row therefore flips to `row-reverse` under `dir="rtl"` (see
 * `.app-workbench-row` in that file) so that this, the last child, stays on
 * the physical right in every locale.
 */
const CollapsedPanesRevealBar: React.FC<CollapsedPanesRevealBarProps> = ({
  collapsedGroups,
  hiddenTitles,
  onExpand,
}) => {
  const { t } = useI18n();

  if (collapsedGroups.length === 0) return null;

  const tooltip = hiddenTitles.length > 0
    ? t('layout.expandCollapsed.tooltipNamed', { titles: hiddenTitles.join(', ') })
    : t('layout.expandCollapsed.tooltip');

  return (
    <button
      type="button"
      onClick={onExpand}
      data-testid="collapsed-panes-reveal-bar"
      title={tooltip}
      aria-label={tooltip}
      className="flex-shrink-0 self-stretch flex items-center justify-center transition-colors"
      style={{
        writingMode: 'vertical-rl',
        width: '28px',
        // OPAQUE, deliberately. A translucent fill reads clearly only while
        // nothing sits behind it; with the rail in normal flow, panes sit
        // right behind it, and a semi-transparent panel over a theme
        // background looks like a smudge rather than a control. color-mix
        // keeps the accent tint (the
        // one token pairing that carries in every theme - see the note on
        // --theme-accent-primary-rgb in themes.css) while resolving to a solid
        // colour, with a solid accent rule facing the workbench.
        backgroundColor: 'color-mix(in srgb, var(--theme-accent-primary) 12%, var(--theme-bg-primary))',
        borderLeft: '2px solid var(--theme-accent-primary)',
        color: 'var(--theme-accent-primary)',
        cursor: 'pointer',
        padding: '12px 4px',
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'color-mix(in srgb, var(--theme-accent-primary) 24%, var(--theme-bg-primary))';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'color-mix(in srgb, var(--theme-accent-primary) 12%, var(--theme-bg-primary))';
      }}
    >
      <span aria-hidden="true">{'‹'}</span> {t('layout.showStudyPanes.label')}
    </button>
  );
};

export default CollapsedPanesRevealBar;
