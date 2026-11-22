/** Kit wizard partagé — étapes guidées uniformes pour tous les formulaires modaux. */
import { useState, type ReactNode } from 'react';
import './form-wizard.css';

export type WizardStepDef = {
  id: string;
  label: string;
  hint?: string;
};

export function useWizard(total: number) {
  const [step, setStep] = useState(1);
  return {
    step,
    total,
    reset: () => setStep(1),
    go: (n: number) => setStep(Math.max(1, Math.min(total, n))),
    back: () => setStep((s) => Math.max(1, s - 1)),
    next: () => setStep((s) => Math.min(total, s + 1)),
    first: step <= 1,
    last: step >= total,
  };
}

export type WizardApi = ReturnType<typeof useWizard>;

export function WizardHeader(props: {
  eyebrow?: string;
  title: string;
  titleId?: string;
  wz: WizardApi;
  steps: readonly WizardStepDef[];
}) {
  const { wz, steps } = props;
  return (
    <>
      <header className="step-wizard__header">
        <div>
          {props.eyebrow && <p className="step-wizard__eyebrow">{props.eyebrow}</p>}
          <h2 id={props.titleId}>{props.title}</h2>
        </div>
        <span className="step-wizard__count">{wz.step} / {wz.total}</span>
      </header>
      <ol
        className="step-wizard__progress"
        data-many-steps={steps.length >= 6 ? 'true' : undefined}
        aria-label={`Étapes : ${props.title}`}
      >
        {steps.map((item, index) => {
          const n = index + 1;
          return (
            <li
              key={item.id}
              className={n === wz.step ? 'is-current' : n < wz.step ? 'is-complete' : ''}
              aria-current={n === wz.step ? 'step' : undefined}
            >
              <button
                type="button"
                className="step-wizard__step-btn"
                onClick={() => wz.go(n)}
              >
                <span>{n < wz.step ? '✓' : n}</span>
                <b>{item.label}</b>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function WizardIntro({ step }: { step: WizardStepDef | undefined }) {
  if (!step) return null;
  return (
    <div className="step-wizard__intro" aria-live="polite">
      <h3>{step.label}</h3>
      {step.hint && <p>{step.hint}</p>}
    </div>
  );
}

export function StepBody({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className={active ? 'wz-step' : 'wz-step wz-off'} aria-hidden={!active}>
      {children}
    </div>
  );
}

export function WizardFoot(props: {
  title: string;
  wz: WizardApi;
  stepLabel: string;
  onCancel: () => void;
  onBack?: () => void;
  onNext?: () => boolean | void;
  onSubmit: () => void;
  submitLabel: string;
  saving?: boolean;
}) {
  const { wz } = props;
  const pct = Math.round((wz.step / wz.total) * 100);
  const handleBack = () => {
    props.onBack?.();
    wz.back();
  };
  const handleNext = () => {
    if (props.onNext && props.onNext() === false) return;
    wz.next();
  };
  return (
    <div className="wizard-foot">
      <div
        className="wz-progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={wz.total}
        aria-valuenow={wz.step}
        aria-label={`Étape ${wz.step} sur ${wz.total}`}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="wizard-foot-nav">
        <span className="wizard-foot-step">
          <span className="wz-chip">Étape {wz.step}/{wz.total}<span className="wz-step-label"> · {props.stepLabel}</span></span>
          {props.title}
        </span>
        <div className="wizard-foot-actions">
          <button type="button" className="secondary" onClick={props.onCancel}>Annuler</button>
          {!wz.first && (
            <button type="button" className="secondary" onClick={handleBack}>Retour</button>
          )}
          {!wz.last && (
            <button type="button" onClick={handleNext}>Continuer</button>
          )}
          {wz.last && (
            <button type="button" onClick={props.onSubmit} disabled={props.saving}>
              {props.saving ? 'Enregistrement…' : props.submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
