/** Kit wizard partagé — étapes guidées uniformes pour tous les formulaires modaux. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './form-wizard.css';

export type WizardStepDef = {
  id: string;
  label: string;
  hint?: string;
};

export function useWizard(total: number) {
  const [step, setStep] = useState(1);
  const [maxReached, setMaxReached] = useState(1);
  const guardRef = useRef<(() => boolean | void) | undefined>(undefined);
  return {
    step,
    maxReached,
    total,
    reset: () => {
      setStep(1);
      setMaxReached(1);
    },
    go: (n: number) => {
      const clamped = Math.max(1, Math.min(total, n));
      setStep(clamped);
      setMaxReached((m) => Math.max(m, clamped));
    },
    back: () => setStep((s) => Math.max(1, s - 1)),
    next: () => {
      setStep((s) => {
        const nextStep = Math.min(total, s + 1);
        setMaxReached((m) => Math.max(m, nextStep));
        return nextStep;
      });
    },
    first: step <= 1,
    last: step >= total,
    _setGuard: (fn: (() => boolean | void) | undefined) => {
      guardRef.current = fn;
    },
    _runGuard: () => {
      if (!guardRef.current) return true;
      return guardRef.current() !== false;
    },
  };
}

type WizardApi = ReturnType<typeof useWizard>;

export function WizardHeader(props: {
  eyebrow?: string;
  title: string;
  titleId?: string;
  wz: WizardApi;
  steps: readonly WizardStepDef[];
  onBeforeJump?: (targetStep: number) => boolean | void;
}) {
  const { wz, steps, onBeforeJump } = props;
  const maxAllowed = wz.maxReached ?? wz.step;
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
          const isUnreachedSkip = n > maxAllowed && n > wz.step + 1;
          return (
            <li
              key={item.id}
              className={
                n === wz.step
                  ? 'is-current'
                  : n < wz.step
                    ? 'is-complete'
                    : isUnreachedSkip
                      ? 'is-locked'
                      : ''
              }
              aria-current={n === wz.step ? 'step' : undefined}
            >
              <button
                type="button"
                className="step-wizard__step-btn"
                disabled={isUnreachedSkip}
                title={isUnreachedSkip ? 'Complétez les étapes précédentes avant d’y accéder' : item.label}
                onClick={() => {
                  if (n === wz.step || isUnreachedSkip) return;
                  if (n > wz.step) {
                    if (onBeforeJump) {
                      if (onBeforeJump(n) === false) return;
                    } else if (!wz._runGuard()) {
                      return;
                    }
                  }
                  wz.go(n);
                }}
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
  const { wz, onNext } = props;
  useEffect(() => {
    wz._setGuard(onNext);
    return () => wz._setGuard(undefined);
  }, [wz, onNext]);
  const pct = Math.round((wz.step / wz.total) * 100);
  const handleBack = () => {
    props.onBack?.();
    wz.back();
  };
  const handleNext = () => {
    if (onNext && onNext() === false) return;
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
          <span className="wz-chip">
            <span>Étape {wz.step}/{wz.total}</span>
            <span className="wz-step-label"> · {props.stepLabel}</span>
          </span>
          <span>{props.title}</span>
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
