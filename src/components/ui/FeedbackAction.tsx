/**
 * Inline error / loading feedback with retry.
 */
import { useState, useEffect, type FC } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { AlertOctagon, Loader2, RotateCw } from 'lucide-react';

export interface FeedbackActionProps {
  errorMessage?: string;
  loadingMessage?: string;
  onRetry?: () => void | Promise<void>;
  /** Controlled status; if omitted, internal demo toggles loading→error */
  status?: 'error' | 'loading' | 'idle';
  className?: string;
}

export const FeedbackAction: FC<FeedbackActionProps> = ({
  errorMessage = 'Échec de la synchronisation',
  loadingMessage = 'Synchronisation…',
  onRetry,
  status: controlled,
  className = '',
}) => {
  const [internal, setInternal] = useState<'error' | 'loading'>('error');
  const status = controlled && controlled !== 'idle' ? controlled : internal;

  const handleRetry = () => {
    if (controlled === undefined) setInternal('loading');
    void onRetry?.();
  };

  useEffect(() => {
    if (controlled !== undefined) return;
    if (internal !== 'loading') return;
    const t = window.setTimeout(() => setInternal('error'), 3500);
    return () => window.clearTimeout(t);
  }, [internal, controlled]);

  if (controlled === 'idle') return null;

  return (
    <div className={`ac-feedback ${className}`.trim()}>
      <MotionConfig transition={{ type: 'spring', bounce: 0.25, duration: 0.55 }}>
        <motion.div layout className="ac-feedback-pill">
          <motion.div
            initial={{ opacity: 0, filter: 'blur(6px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            className="ac-feedback-inner"
          >
            <AnimatePresence mode="popLayout">
              <motion.div
                key={status}
                layout
                initial={{ opacity: 0, scale: 0.4, filter: 'blur(2px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.4, filter: 'blur(2px)' }}
                transition={{ type: 'spring', bounce: 0, duration: 0.28 }}
                className="ac-feedback-ico"
              >
                {status === 'error' ? (
                  <AlertOctagon size={22} className="ac-feedback-ico-error" />
                ) : (
                  <Loader2 size={22} className="ac-feedback-ico-load" />
                )}
              </motion.div>
            </AnimatePresence>
            <AnimatedText
              text={status === 'error' ? errorMessage : loadingMessage}
              className={status === 'error' ? 'ac-feedback-text error' : 'ac-feedback-text'}
            />
          </motion.div>
        </motion.div>

        <AnimatePresence mode="popLayout">
          {status === 'error' && (
            <motion.button
              type="button"
              key="retry"
              initial={{ opacity: 0, x: -40, filter: 'blur(4px)', scale: 0.85 }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)', scale: 1 }}
              exit={{ opacity: 0, x: -40, filter: 'blur(4px)', scale: 0.85 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
              onClick={handleRetry}
              className="ac-feedback-retry"
              aria-label="Réessayer"
            >
              <RotateCw size={20} />
            </motion.button>
          )}
        </AnimatePresence>
      </MotionConfig>
    </div>
  );
};

function AnimatedText({
  text,
  className,
  delayStep = 0.012,
}: {
  text: string;
  className?: string;
  delayStep?: number;
}) {
  const chars = text.split('');
  return (
    <span className={className} style={{ display: 'inline-flex' }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={text} style={{ display: 'inline-flex' }}>
          {chars.map((char, i) => (
            <motion.span
              key={`${text}-${i}`}
              initial={{ y: 8, opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
              animate={{ y: 0, opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ y: -8, opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
              transition={{
                type: 'spring',
                stiffness: 240,
                damping: 16,
                delay: i * delayStep,
              }}
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

export default FeedbackAction;
