/** Attribution for the installed quiz modules (their content is licensed; showing it is required). */
import type { QuizModuleInfo } from '@bible/core/browser';
import { fillLabel, mergeQuizLabels } from './labels';
import type { QuizLabels } from './types';

export interface QuizSourcesProps {
  modules: QuizModuleInfo[];
  labels?: Partial<QuizLabels>;
  className?: string;
}

export function QuizSources({ modules, labels, className }: QuizSourcesProps) {
  const l = mergeQuizLabels(labels);
  if (modules.length === 0) return null;
  return (
    <section className={className ? `kth-quiz__sources ${className}` : 'kth-quiz__sources'} aria-label={l.sourcesHeading}>
      <h3 className="kth-quiz__sources-heading">{l.sourcesHeading}</h3>
      <ul className="kth-quiz__sources-list">
        {modules.map((m) => (
          <li key={m.uuid} className="kth-quiz__source">
            <div>
              <strong>{m.name}</strong>
              {m.version ? ` ${m.version}` : ''}
              {m.license ? (
                <>
                  {' · '}
                  {m.licenseUrl ? (
                    <a className="kth-quiz__link" href={m.licenseUrl} target="_blank" rel="noreferrer noopener">
                      {m.license}
                    </a>
                  ) : (
                    m.license
                  )}
                </>
              ) : null}
            </div>
            {m.description ? <p className="kth-quiz__small">{m.description}</p> : null}
            {m.textBasis ? <p className="kth-quiz__small">{fillLabel(l.textBasis, { translation: m.textBasis })}</p> : null}
            {m.sources.length > 0 ? (
              <ul className="kth-quiz__sources-list kth-quiz__small">
                {m.sources.map((s) => (
                  <li key={s.id}>
                    {s.attribution ?? s.name}
                    {' ('}
                    {s.url ? (
                      <a className="kth-quiz__link" href={s.url} target="_blank" rel="noreferrer noopener">
                        {s.name}
                      </a>
                    ) : (
                      s.name
                    )}
                    {s.licence ? `, ${s.licence}` : ''}
                    {')'}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
