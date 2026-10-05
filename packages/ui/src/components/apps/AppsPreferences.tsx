import type { ReactNode } from 'react';

export type AppsPreferencesMode = 'auto' | 'rail' | 'none';

export interface AppsPreferencesLabels {
  switcherLabel: string;
  switcherHint: string;
  modeAuto: string;
  modeRail: string;
  modeNone: string;
  listLabel: string;
  listHint: string;
  moveUp: string;
  moveDown: string;
  show: string;
  alwaysShown: string;
}

export const DEFAULT_APPS_PREFERENCES_LABELS: AppsPreferencesLabels = {
  switcherLabel: 'App switcher',
  switcherHint: 'Show the app rail always, never, or only when more than one app is available.',
  modeAuto: 'Automatic',
  modeRail: 'Always show the rail',
  modeNone: 'No rail',
  listLabel: 'Apps',
  listHint: 'Reorder apps or hide the ones you do not use.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  show: 'Show',
  alwaysShown: 'Always shown',
};

export interface AppsPreferencesItem {
  id: string;
  title: string;
  icon?: ReactNode;
  hidden: boolean;
  /** Cannot be hidden (Study). */
  locked?: boolean;
}

export interface AppsPreferencesProps {
  mode: AppsPreferencesMode;
  onModeChange: (mode: AppsPreferencesMode) => void;
  /** Every app in the current order, hidden ones included. */
  items: AppsPreferencesItem[];
  /** The full new order of ids. */
  onOrderChange: (ids: string[]) => void;
  onHiddenChange: (id: string, hidden: boolean) => void;
  labels?: Partial<AppsPreferencesLabels>;
  idPrefix?: string;
}

/** Preferences > Apps: the switcher mode and the order/hide list. Strings arrive as labels. */
export function AppsPreferences(props: AppsPreferencesProps) {
  const { mode, onModeChange, items, onOrderChange, onHiddenChange, idPrefix = 'kth-apps-pref' } = props;
  const l = { ...DEFAULT_APPS_PREFERENCES_LABELS, ...props.labels };
  const move = (index: number, delta: number) => {
    const ids = items.map((i) => i.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    onOrderChange(ids);
  };
  const modes: [AppsPreferencesMode, string][] = [
    ['auto', l.modeAuto],
    ['rail', l.modeRail],
    ['none', l.modeNone],
  ];
  return (
    <div className="kth-apps-pref">
      <div className="kth-field">
        <label className="kth-label" htmlFor={`${idPrefix}-mode`}>{l.switcherLabel}</label>
        <select
          id={`${idPrefix}-mode`}
          className="kth-select"
          value={mode}
          aria-describedby={`${idPrefix}-mode-hint`}
          onChange={(e) => onModeChange(e.target.value as AppsPreferencesMode)}
        >
          {modes.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        <p className="kth-hint" id={`${idPrefix}-mode-hint`}>{l.switcherHint}</p>
      </div>
      <div className="kth-field" role="group" aria-labelledby={`${idPrefix}-list`}>
        <span className="kth-label" id={`${idPrefix}-list`}>{l.listLabel}</span>
        <p className="kth-hint">{l.listHint}</p>
        <ul className="kth-apps-pref__list">
          {items.map((item, index) => (
            <li key={item.id} className="kth-apps-pref__row" data-app-id={item.id}>
              <span className="kth-apps-pref__icon" aria-hidden="true">{item.icon}</span>
              <span className="kth-apps-pref__title">{item.title}</span>
              <label className="kth-apps-pref__show">
                <input
                  type="checkbox"
                  checked={!item.hidden}
                  disabled={item.locked}
                  title={item.locked ? l.alwaysShown : undefined}
                  onChange={(e) => onHiddenChange(item.id, !e.target.checked)}
                />
                <span>{l.show}</span>
              </label>
              <button type="button" className="kth-btn kth-btn--icon" aria-label={`${l.moveUp}: ${item.title}`} disabled={index === 0} onClick={() => move(index, -1)}>
                <span aria-hidden="true">{'↑'}</span>
              </button>
              <button type="button" className="kth-btn kth-btn--icon" aria-label={`${l.moveDown}: ${item.title}`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                <span aria-hidden="true">{'↓'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
