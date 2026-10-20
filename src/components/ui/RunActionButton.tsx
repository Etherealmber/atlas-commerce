import React, { useEffect, useState, type ComponentType } from 'react';
import { motion, AnimatePresence, type Transition } from 'motion/react';
import {
  Zap,
  Inbox,
  Sparkles,
  Tags,
  Clock,
  FileText,
  Send,
  BadgeCheck,
  X,
  Download,
  Database,
  Table,
  Package,
} from 'lucide-react';

function AnimatedText({
  text,
  className,
  delayStep = 0.014,
}: {
  text: string;
  className?: string;
  delayStep?: number;
}) {
  const chars = text.split('');
  return (
    <span className={className} style={{ display: 'inline-flex' }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={text} style={{ display: 'inline-flex', willChange: 'transform' }}>
          {chars.map((char, i) => (
            <motion.span
              key={`${i}-${char}`}
              initial={{ y: 10, opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
              animate={{ y: 0, opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ y: -10, opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
              transition={{
                type: 'spring',
                stiffness: 240,
                damping: 16,
                mass: 1.2,
                delay: i * delayStep,
              }}
              style={{
                display: 'inline-block',
                whiteSpace: char === ' ' ? 'pre' : undefined,
              }}
            >
              {char}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const spring: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 22,
  mass: 0.8,
};

export type RunStep = {
  id: number;
  label: string;
  icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
};

const DEFAULT_STEPS: RunStep[] = [
  { id: 1, label: 'Lecture des données', icon: Inbox },
  { id: 2, label: 'Affinage', icon: Sparkles },
  { id: 3, label: 'Classement', icon: Tags },
  { id: 4, label: 'Analyse', icon: Clock },
  { id: 5, label: 'Création du rapport', icon: FileText },
  { id: 6, label: 'Prêt à télécharger', icon: Send },
];

/** Steps for CSV / JSON product & report exports */
export const EXPORT_CSV_STEPS: RunStep[] = [
  { id: 1, label: 'Lecture catalogue', icon: Database },
  { id: 2, label: 'Calcul des stocks', icon: Package },
  { id: 3, label: 'Mise en tableau', icon: Table },
  { id: 4, label: 'Génération CSV', icon: FileText },
  { id: 5, label: 'Téléchargement', icon: Download },
];

export const EXPORT_REPORT_STEPS: RunStep[] = [
  { id: 1, label: 'Collecte des écritures', icon: Inbox },
  { id: 2, label: 'Calculs TVA / soldes', icon: Sparkles },
  { id: 3, label: 'Mise en forme', icon: FileText },
  { id: 4, label: 'Export fichier', icon: Download },
];

type RunActionButtonProps = {
  steps?: RunStep[];
  idleLabel?: string;
  doneLabel?: string;
  /** Real work — called when user starts; resolve when export is done */
  onRun?: () => Promise<void>;
  /** Auto-advance step interval while waiting (ms) */
  stepMs?: number;
  className?: string;
  size?: 'sm' | 'md';
};

export function RunActionButton({
  steps = DEFAULT_STEPS,
  idleLabel = 'Lancer',
  doneLabel = 'Terminé',
  onRun,
  stepMs = 900,
  className = '',
  size = 'sm',
}: RunActionButtonProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [currentStep, setCurrentStep] = useState(0);

  const h = size === 'sm' ? 40 : 52;
  const fontSize = size === 'sm' ? 13 : 16;
  const iconSz = size === 'sm' ? 16 : 22;
  const widths = {
    idle: size === 'sm' ? 132 : 180,
    running: size === 'sm' ? 280 : 340,
    done: size === 'sm' ? 148 : 200,
  };

  const reset = () => {
    setStatus('idle');
    setCurrentStep(0);
  };

  const startAction = async () => {
    if (status !== 'idle') return;
    setStatus('running');
    setCurrentStep(0);
    try {
      if (onRun) {
        await onRun();
      } else {
        await new Promise((r) => setTimeout(r, steps.length * stepMs));
      }
      setCurrentStep(steps.length - 1);
      setStatus('done');
      window.setTimeout(() => reset(), 2200);
    } catch {
      reset();
    }
  };

  useEffect(() => {
    if (status !== 'running') return;
    const interval = window.setInterval(() => {
      setCurrentStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, stepMs);
    return () => window.clearInterval(interval);
  }, [status, steps.length, stepMs]);

  const StepIcon = steps[Math.min(currentStep, steps.length - 1)]?.icon || Zap;

  return (
    <div className={`ac-run-action ${className}`.trim()} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <motion.div
        initial={false}
        animate={{ width: widths[status] }}
        transition={spring}
        style={{
          position: 'relative',
          display: 'flex',
          height: h,
          alignItems: 'center',
          justifyContent: 'space-between',
          overflow: 'hidden',
          borderRadius: 9999,
          border:
            status === 'running'
              ? '2px dashed rgba(0,0,0,0.14)'
              : status === 'idle'
                ? 'none'
                : '2px solid transparent',
          background: status === 'idle' ? 'transparent' : status === 'done' ? '#eef2ff' : 'transparent',
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {status === 'idle' && (
            <motion.button
              key="idle"
              type="button"
              className="secondary ac-run-action-btn"
              onClick={() => void startAction()}
              initial={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
              transition={spring}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                border: '1px solid #e5e0d6',
                background: '#ffffff',
                cursor: 'pointer',
                padding: '0 16px',
                whiteSpace: 'nowrap',
                fontWeight: 600,
                fontSize,
                color: '#0a0a0a',
                borderRadius: 9999,
                minHeight: h,
                height: h,
                boxShadow: 'none',
              }}
            >
              <Zap size={iconSz} strokeWidth={2.2} />
              <AnimatedText text={idleLabel} className="" />
            </motion.button>
          )}
          {status === 'running' && (
            <motion.div
              key="running"
              initial={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
              transition={spring}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '0 10px 0 14px',
                whiteSpace: 'nowrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={currentStep}
                    initial={{ opacity: 0, scale: 0, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, scale: 0, filter: 'blur(4px)' }}
                    transition={spring}
                    style={{ display: 'flex', flexShrink: 0 }}
                  >
                    <StepIcon size={iconSz} strokeWidth={2.2} />
                  </motion.div>
                </AnimatePresence>
                <AnimatedText
                  text={steps[Math.min(currentStep, steps.length - 1)]?.label || '…'}
                  className=""
                />
              </div>
              <motion.button
                type="button"
                onClick={reset}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...spring, delay: 0.12 }}
                aria-label="Annuler"
                style={{
                  border: 'none',
                  borderRadius: 999,
                  background: '#d6d5e2',
                  width: 28,
                  height: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                <X size={14} color="#fff" strokeWidth={2.5} />
              </motion.button>
            </motion.div>
          )}
          {status === 'done' && (
            <motion.button
              key="done"
              type="button"
              onClick={reset}
              initial={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
              transition={spring}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: '0 14px',
                whiteSpace: 'nowrap',
                fontWeight: 700,
                fontSize,
                color: '#3f3f46',
              }}
            >
              <BadgeCheck size={iconSz + 2} color="#71717a" />
              <AnimatedText text={doneLabel} className="" />
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default RunActionButton;
