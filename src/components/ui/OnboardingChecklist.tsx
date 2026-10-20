import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronUp, ChevronRight, Check } from 'lucide-react';

export type OnboardingStep = { id: number; title: string; isCompleted: boolean; href?: string };

export function OnboardingChecklist({
  steps,
  title = 'Premiers pas',
  onStepClick,
}: {
  steps: OnboardingStep[];
  title?: string;
  onStepClick?: (step: OnboardingStep) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const completedCount = steps.filter((s) => s.isCompleted).length;
  const totalSteps = steps.length || 1;
  const springConfig = { type: 'spring' as const, stiffness: 300, damping: 30 };

  return (
    <motion.div layout transition={springConfig} className="ac-onboard">
      <button type="button" className="ac-onboard-head" onClick={() => setIsExpanded((v) => !v)}>
        <span className="ac-onboard-title-wrap">
          <motion.span animate={{ rotate: isExpanded ? 0 : 180 }} className="ac-onboard-chev">
            <ChevronUp size={20} />
          </motion.span>
          <span className="ac-onboard-title">{title}</span>
        </span>
        <span className="ac-onboard-progress">
          <span className="ac-onboard-bars" aria-hidden>
            {Array.from({ length: 14 }).map((_, i) => (
              <span
                key={i}
                className={i < (completedCount / totalSteps) * 14 ? 'on' : ''}
              />
            ))}
          </span>
          <span className="ac-onboard-count">
            {completedCount}/{totalSteps}
          </span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springConfig}
            className="ac-onboard-body-wrap"
          >
            <div className="ac-onboard-body">
              {steps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className="ac-onboard-step"
                  onClick={() => onStepClick?.(step)}
                >
                  <span className="ac-onboard-step-left">
                    {step.isCompleted ? (
                      <span className="ac-onboard-check">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="ac-onboard-num">{step.id}</span>
                    )}
                    <span className={step.isCompleted ? 'done' : ''}>{step.title}</span>
                  </span>
                  {!step.isCompleted && <ChevronRight size={16} className="ac-onboard-arrow" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default OnboardingChecklist;
