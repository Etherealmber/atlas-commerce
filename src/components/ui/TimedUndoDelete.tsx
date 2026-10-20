import { useEffect, useState, type FC, type KeyboardEvent, type ReactNode, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Undo2 } from 'lucide-react';

export interface TimedUndoDeleteProps {
  initialSeconds?: number;
  deleteLabel?: string;
  undoLabel?: string;
  icon?: ReactNode;
  onConfirm?: () => void;
  onDelete?: () => void;
  className?: string;
  width?: string;
  autoStart?: boolean;
}

const RED = '#ef4444';
const RED_HOVER = '#dc2626';
const ARMED_BG = '#fee2e2';
const ARMED_FG = '#b91c1c';

const digitVariants = {
  initial: { y: 12, opacity: 0, scale: 0.55, filter: 'blur(2px)' },
  animate: { y: 0, opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { y: -12, opacity: 0, scale: 0.55, filter: 'blur(2px)' },
};

/** Timed delete — div[role=button] so global .content button black never applies. */
export const TimedUndoDelete: FC<TimedUndoDeleteProps> = ({
  initialSeconds = 10,
  deleteLabel = 'Supprimer',
  undoLabel = 'Annuler',
  icon,
  onConfirm,
  onDelete,
  className = '',
  width = '10.5rem',
  autoStart = false,
}) => {
  const [isDeleting, setIsDeleting] = useState(autoStart);
  const [countDown, setCountDown] = useState(initialSeconds);
  const [hover, setHover] = useState(false);

  const commit = onConfirm || onDelete || (() => {});

  useEffect(() => {
    if (!isDeleting) return;
    const interval = window.setInterval(() => {
      setCountDown((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          setIsDeleting(false);
          commit();
          return initialSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isDeleting, initialSeconds, commit]);

  useEffect(() => {
    if (!isDeleting) return;
    const cancel = () => {
      setIsDeleting(false);
      setCountDown(initialSeconds);
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    window.addEventListener('pagehide', cancel);
    window.addEventListener('beforeunload', cancel);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', cancel);
      window.removeEventListener('beforeunload', cancel);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [isDeleting, initialSeconds]);

  const handleClick = () => {
    if (isDeleting) {
      setIsDeleting(false);
      setCountDown(initialSeconds);
      return;
    }
    setCountDown(initialSeconds);
    setIsDeleting(true);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const wrapStyle: CSSProperties = {
    display: 'inline-flex',
    width,
    minWidth: width,
    maxWidth: width,
    flex: `0 0 ${width}`,
    verticalAlign: 'middle',
  };

  const btnStyle: CSSProperties = {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    height: 36,
    padding: '0 10px',
    borderRadius: 999,
    border: 'none',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 700,
    fontFamily: 'inherit',
    lineHeight: 1,
    background: isDeleting ? ARMED_BG : hover ? RED_HOVER : RED,
    color: isDeleting ? ARMED_FG : '#ffffff',
    WebkitTextFillColor: isDeleting ? ARMED_FG : '#ffffff',
    boxShadow: 'none',
    outline: 'none',
  };

  const chipStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    minWidth: 22,
    borderRadius: 999,
    background: RED,
    color: '#ffffff',
    WebkitTextFillColor: '#ffffff',
    fontSize: 11,
    fontWeight: 800,
    overflow: 'hidden',
    flexShrink: 0,
  };

  return (
    <div className={`ac-timed-delete ${className}`.trim()} style={wrapStyle} data-atlas-delete="1">
      <div
        role="button"
        tabIndex={0}
        aria-label={isDeleting ? undoLabel : deleteLabel}
        className={`ac-timed-delete-btn${isDeleting ? ' is-armed' : ''}`}
        data-atlas-delete-btn="1"
        onClick={handleClick}
        onKeyDown={onKey}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={btnStyle}
      >
        {isDeleting ? (
          <>
            <span style={{ ...chipStyle, background: RED }} aria-hidden>
              {icon ?? <Undo2 size={13} strokeWidth={2.5} color="#fff" />}
            </span>
            <span style={{ whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>{undoLabel}</span>
            <span style={chipStyle} aria-live="polite">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={countDown}
                  className="ac-timed-delete-digit"
                  variants={digitVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ type: 'spring', stiffness: 320, damping: 22, mass: 0.85 }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    WebkitTextFillColor: '#ffffff',
                    fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                  }}
                >
                  <span
                    data-countdown-digit="1"
                    className="ac-timed-delete-digit"
                    style={{ color: '#ffffff', WebkitTextFillColor: '#ffffff', fontWeight: 800 }}
                  >
                    {countDown}
                  </span>
                </motion.span>
              </AnimatePresence>
            </span>
          </>
        ) : (
          <span style={{ whiteSpace: 'nowrap' }}>{deleteLabel}</span>
        )}
      </div>
    </div>
  );
};

export default TimedUndoDelete;
