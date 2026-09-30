/**
 * Controls shared by the verse web and the constellation (task 0068): how many hops to show and the minimum
 * link strength, each with a visible label, a tooltip and an expandable plain-language explanation.
 *
 * Both controls describe what the query asks the provider for: `depth` is `EgoOptions.depth` and the strength
 * step becomes `EgoOptions.minWeight` through {@link minWeightForStep}.
 */
import { useId, useState } from 'react';

export interface XrefControlLabels {
  back: string;
  /** Visible label of the 1/2/3 group. */
  depthLabel: string;
  /** Tooltip and help text for the hop count. */
  depthHint: string;
  /** Accessible name and tooltip of one option; `{n}` is 1..3. */
  depthOption: string;
  /** Visible label of the strength slider. */
  minWeight: string;
  /** Tooltip and help text for the strength slider. */
  minStrengthHint: string;
  /** Value text when nothing is filtered out. */
  minStrengthAny: string;
  /** Value text otherwise; `{n}` is 2..5. */
  minStrengthValue: string;
  /** Accessible name of the "what do these mean" button. */
  help: string;
}

export const DEFAULT_XREF_CONTROL_LABELS: XrefControlLabels = {
  back: 'Back',
  depthLabel: 'Hops',
  depthHint:
    'How far from the centre verse to look. 1 shows the verses it references directly, 2 adds the verses those reference, and 3 goes one step further.',
  depthOption: 'Hops: {n}',
  minWeight: 'Minimum strength',
  minStrengthHint:
    'Hides weaker links. Strength (1 to 5) is how closely two verses are tied: the Treasury of Scripture Knowledge lists the most direct references first for each phrase, and links that run both ways or appear in more than one source score higher. 1 shows every link, 5 only the strongest.',
  minStrengthAny: 'Any',
  minStrengthValue: '{n} of 5 and up',
  help: 'What do these controls mean?',
};

export const fillTpl = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** The weight floor for "strength step n or stronger" (steps are `ceil(weight * 5)`; 1 keeps everything). */
export function minWeightForStep(step: number): number {
  return step <= 1 ? 0 : Math.min(0.99, (step - 1) / 5 + 0.001);
}

interface DepthProps {
  labels: XrefControlLabels;
  depth: 1 | 2 | 3;
  onChange: (depth: 1 | 2 | 3) => void;
  className: string;
}

export function XrefDepthControl({ labels, depth, onChange, className }: DepthProps) {
  return (
    <div className="kth-xref-web__field" title={labels.depthHint}>
      <span aria-hidden="true">{labels.depthLabel}</span>
      <div className="kth-xref-web__group" role="group" aria-label={labels.depthLabel}>
        {([1, 2, 3] as const).map((n) => (
          <button
            key={n}
            type="button"
            className={className}
            aria-pressed={depth === n}
            aria-label={fillTpl(labels.depthOption, { n })}
            title={fillTpl(labels.depthOption, { n })}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

interface StrengthProps {
  labels: XrefControlLabels;
  /** 1..5 (1 = every link). */
  step: number;
  onChange: (step: number) => void;
}

export function XrefStrengthControl({ labels, step, onChange }: StrengthProps) {
  const valueText = step <= 1 ? labels.minStrengthAny : fillTpl(labels.minStrengthValue, { n: step });
  return (
    <label className="kth-xref-web__field" title={labels.minStrengthHint}>
      <span>{labels.minWeight}</span>
      <input
        type="range"
        className="kth-xref-web__slider"
        min={1}
        max={5}
        step={1}
        value={step}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <span className="kth-xref-web__value">{valueText}</span>
    </label>
  );
}

/** A small "?" that reveals the plain-language help for both controls. */
export function XrefControlsHelp({ labels, buttonClass }: { labels: XrefControlLabels; buttonClass: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className={buttonClass}
        aria-expanded={open}
        aria-controls={id}
        aria-label={labels.help}
        title={labels.help}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <div id={id} className="kth-xref-web__help" role="note">
          <p><strong>{labels.depthLabel}.</strong> {labels.depthHint}</p>
          <p><strong>{labels.minWeight}.</strong> {labels.minStrengthHint}</p>
        </div>
      )}
    </>
  );
}
