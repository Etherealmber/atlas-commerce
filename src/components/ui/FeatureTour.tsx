import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';

export type TourStep = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
};

type Props = {
  steps: TourStep[];
  onClose: () => void;
  onLearnMore?: (step: TourStep) => void;
  loop?: boolean;
};

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const FeatureTour: FC<Props> = ({ steps, onClose, onLearnMore, loop = false }) => {
  const shouldReduceMotion = useReducedMotion();
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === steps.length - 1 ? (loop ? 0 : prev) : prev + 1));
  }, [loop, steps.length]);
  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? (loop ? steps.length - 1 : prev) : prev - 1));
  }, [loop, steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, onClose]);

  if (!steps.length) return null;
  const currentStep = steps[currentIndex];

  return (
    <div className="ac-feature-tour" role="dialog" aria-modal="true">
      <button type="button" className="ac-feature-tour-backdrop" aria-label="Fermer" onClick={onClose} />
      <motion.div
        ref={containerRef}
        className="ac-feature-tour-card"
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 12 }}
        transition={{ duration: 0.2, ease: EASE_OUT }}
      >
        <button type="button" className="ac-feature-tour-close" onClick={onClose} aria-label="Fermer">
          <X size={18} strokeWidth={2.5} />
        </button>

        <div className="ac-feature-tour-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep.id}
              className="ac-feature-tour-icon-wrap"
              initial={{ opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              <div className="ac-feature-tour-icon-bg" />
              <div className="ac-feature-tour-icon">{currentStep.icon}</div>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.div
              key={`c-${currentStep.id}`}
              className="ac-feature-tour-copy"
              initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -12 }}
            >
              <h2>{currentStep.title}</h2>
              <p>{currentStep.description}</p>
              {onLearnMore && (
                <button type="button" className="secondary" onClick={() => onLearnMore(currentStep)}>
                  En savoir plus
                </button>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="ac-feature-tour-dots" role="tablist">
          {steps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              role="tab"
              aria-selected={index === currentIndex}
              aria-label={step.title}
              className={index === currentIndex ? 'on' : ''}
              onClick={() => setCurrentIndex(index)}
            />
          ))}
        </div>

        <div className="ac-feature-tour-nav">
          <button type="button" className="secondary" onClick={goPrev} disabled={currentIndex === 0 && !loop}>
            Précédent
          </button>
          {currentIndex < steps.length - 1 ? (
            <button type="button" onClick={goNext}>
              Suivant
            </button>
          ) : (
            <button type="button" onClick={onClose}>
              Terminer
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default FeatureTour;
