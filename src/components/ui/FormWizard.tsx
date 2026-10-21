/** Kit wizard partagé — étapes légères pour tous les formulaires modaux. */
import { useState, type ReactNode } from 'react';

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
  onSubmit: () => void;
  submitLabel: string;
  saving?: boolean;
}) {
  const { wz } = props;
  return (
    <div className="wizard-foot">
      <div className="wizard-foot-nav">
        <span className="wizard-foot-step">
          <span className="wz-chip">Étape {wz.step}/{wz.total}<span className="wz-step-label"> · {props.stepLabel}</span></span>
          {props.title}
        </span>
        <div className="wizard-foot-actions">
          <button type="button" className="secondary" onClick={props.onCancel}>Annuler</button>
          {!wz.first && (
            <button type="button" className="secondary" onClick={wz.back}>Retour</button>
          )}
          {!wz.last && (
            <button type="button" onClick={wz.next}>Continuer</button>
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
