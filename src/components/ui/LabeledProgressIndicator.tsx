/**
 * Rotating status labels + animated progress bar (loaders / long jobs).
 */
import { useState, useEffect, type FC } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface LabeledProgressIndicatorProps {
  labels: string[];
  /** CSS width, e.g. "55%" or "0.55" as fraction string with % */
  progress?: string;
  intervalMs?: number;
  className?: string;
}

export const LabeledProgressIndicator: FC<LabeledProgressIndicatorProps> = ({
  labels,
  progress = '55%',
  intervalMs = 2000,
  className = '',
}) => {
  const [labelIndex, setLabelIndex] = useState(0);
  const safeLabels = labels?.length ? labels : ['Chargement…'];

  useEffect(() => {
    if (safeLabels.length <= 1) return;
    const interval = setInterval(() => {
      setLabelIndex((prev) => (prev + 1) % safeLabels.length);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [safeLabels.length, intervalMs]);

  const width = progress.includes('%') ? progress : `${Number(progress) * 100}%`;

  return (
    <div className={`ac-labeled-progress ${className}`.trim()}>
      <div className="ac-labeled-progress-label-wrap">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={labelIndex}
            initial={{ opacity: 0, y: 10, scale: 1.4, filter: 'blur(4px)', rotateX: -40 }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', rotateX: 0 }}
            exit={{ opacity: 0, filter: 'blur(4px)', rotateX: 50, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 1.2 }}
            className="ac-labeled-progress-label"
          >
            {safeLabels[labelIndex]}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="ac-labeled-progress-track" role="progressbar" aria-valuenow={parseInt(width, 10) || 0} aria-valuemin={0} aria-valuemax={100}>
        <motion.div
          className="ac-labeled-progress-fill"
          initial={{ width: '0%' }}
          animate={{ width }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        >
          <motion.div
            className="ac-labeled-progress-sheen"
            initial={{ x: '-100%' }}
            animate={{ x: '200%' }}
            transition={{
              duration: Math.max(1.2, intervalMs / 1000),
              repeat: Infinity,
              ease: 'linear',
            }}
          />
        </motion.div>
      </div>
    </div>
  );
};

export default LabeledProgressIndicator;
