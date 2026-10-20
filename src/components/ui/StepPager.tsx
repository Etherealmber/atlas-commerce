/**
 * Step pager — animated label + icon track (wizard / onboarding).
 */
import React, { useState, type ElementType } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, CircleDot, Heart, SlidersHorizontal, ListMusic } from 'lucide-react';

export interface StepItem {
  id: number | string;
  label: string;
  icon: ElementType;
}

const defaultItems: StepItem[] = [
  { id: 1, label: 'Explorer', icon: CircleDot },
  { id: 2, label: 'Sélection', icon: Heart },
  { id: 3, label: 'Réglages', icon: SlidersHorizontal },
  { id: 4, label: 'Lancer', icon: ListMusic },
];

export interface StepPagerProps {
  steps?: StepItem[];
  initialStep?: number;
  /** Controlled index */
  index?: number;
  onIndexChange?: (i: number) => void;
  className?: string;
}

export function StepPager({
  steps = defaultItems,
  initialStep = 0,
  index,
  onIndexChange,
  className = '',
}: StepPagerProps) {
  const [internal, setInternal] = useState(initialStep);
  const activeIndex = index ?? internal;
  const setActive = (i: number) => {
    if (index === undefined) setInternal(i);
    onIndexChange?.(i);
  };
  const nextStep = () => setActive((activeIndex + 1) % steps.length);
  const prevStep = () => setActive((activeIndex - 1 + steps.length) % steps.length);

  return (
    <div className={`ac-step-pager ${className}`.trim()}>
      <div className="ac-step-pager-label">
        <AnimatedText text={steps[activeIndex]?.label || ''} className="ac-step-pager-label-text" />
      </div>
      <div className="ac-step-pager-row">
        <button type="button" title="Précédent" className="ac-step-pager-arrow" onClick={prevStep}>
          <ChevronLeft size={24} strokeWidth={2.5} />
        </button>
        <div className="ac-step-pager-track">
          {steps.map((step, i) => {
            const isActive = i === activeIndex;
            const Icon = step.icon;
            return (
              <button
                key={step.id}
                type="button"
                className="ac-step-pager-slot"
                onClick={() => setActive(i)}
                aria-current={isActive ? 'step' : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="ac-step-active-pill"
                    className="ac-step-pager-pill"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <AnimatePresence mode="popLayout">
                  <motion.span
                    key={isActive ? 'on' : 'off'}
                    className="ac-step-pager-icon"
                    initial={{ opacity: 0, filter: 'blur(4px)', scale: isActive ? 0.6 : 1 }}
                    animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
                    exit={{ opacity: 0, filter: 'blur(4px)', scale: 0.6 }}
                    transition={{ duration: 0.25 }}
                  >
                    {isActive ? <Icon size={22} /> : <span className="ac-step-pager-dot" />}
                  </motion.span>
                </AnimatePresence>
              </button>
            );
          })}
        </div>
        <button type="button" title="Suivant" className="ac-step-pager-arrow" onClick={nextStep}>
          <ChevronRight size={24} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

function AnimatedText({ text, className, delayStep = 0.03 }: { text: string; className?: string; delayStep?: number }) {
  const chars = text.split('');
  return (
    <span className={className} style={{ display: 'inline-flex' }}>
      <AnimatePresence mode="popLayout">
        <motion.span key={text} style={{ display: 'inline-flex' }}>
          {chars.map((char, i) => (
            <motion.span
              key={`${text}-${i}`}
              initial={{ y: 10, opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
              animate={{ y: 0, opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ y: -10, opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
              transition={{ type: 'spring', stiffness: 240, damping: 16, delay: i * delayStep }}
              style={{ display: 'inline-block', whiteSpace: char === ' ' ? 'pre' : undefined }}
            >
              {char}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export default StepPager;
