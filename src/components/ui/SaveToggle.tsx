import React, { useEffect, useState, type FC } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';

type ButtonStatus = 'idle' | 'loading' | 'success' | 'saved';
type Size = 'sm' | 'md' | 'lg';

const SIZE_CONFIG = {
  sm: {
    height: 36,
    circleWidth: 36,
    idleWidth: 112,
    savedWidth: 128,
    text: 13,
    icon: 16,
    spinner: 18,
  },
  md: {
    height: 40,
    circleWidth: 40,
    idleWidth: 128,
    savedWidth: 140,
    text: 14,
    icon: 18,
    spinner: 20,
  },
  lg: {
    height: 48,
    circleWidth: 48,
    idleWidth: 148,
    savedWidth: 160,
    text: 15,
    icon: 22,
    spinner: 24,
  },
};

export interface SaveToggleProps {
  size?: Size;
  idleText?: string;
  savedText?: string;
  /** Controlled busy from parent (API call) */
  busy?: boolean;
  /** When true after busy ends → success → saved */
  success?: boolean;
  /** Reset to idle when this flips */
  dirty?: boolean;
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
  className?: string;
}

/** Animated save control: idle → spinner → check → « Enregistré ». */
export const SaveToggle: FC<SaveToggleProps> = ({
  size = 'sm',
  idleText = 'Enregistrer',
  savedText = 'Enregistré',
  busy = false,
  success = false,
  dirty = true,
  disabled = false,
  onClick,
  className = '',
}) => {
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const cfg = SIZE_CONFIG[size];
  const stableWidth = Math.max(cfg.idleWidth, cfg.savedWidth);
  const isDark =
    typeof document !== 'undefined' &&
    (document.documentElement.getAttribute('data-theme') === 'dark' ||
      document.documentElement.classList.contains('dark'));

  useEffect(() => {
    if (busy) {
      setStatus('loading');
      return;
    }
    if (success) {
      setStatus('success');
      const t = window.setTimeout(() => setStatus('saved'), 700);
      return () => window.clearTimeout(t);
    }
  }, [busy, success]);

  useEffect(() => {
    if (dirty && status === 'saved') setStatus('idle');
  }, [dirty, status]);

  const handleClick = async () => {
    if (disabled || status === 'loading') return;
    if (status === 'saved') {
      setStatus('idle');
      return;
    }
    if (onClick) await onClick();
  };

  const isCircle = status === 'loading' || status === 'success';

  const bg =
    status === 'loading' || status === 'success'
      ? isDark
        ? '#fafafa'
        : '#18181b'
      : status === 'saved'
        ? isDark
          ? '#27272a'
          : '#ffffff'
        : isDark
          ? '#27272a'
          : '#e8e7e0';

  const border =
    status === 'saved' ? (isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.18)') : '1px solid transparent';

  const checkColor =
    status === 'success' ? (isDark ? '#18181b' : '#ffffff') : isDark ? '#a1a1aa' : '#27272a';

  return (
    <MotionConfig transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 1 }}>
      <motion.button
        type="button"
        disabled={disabled || status === 'loading'}
        onClick={() => void handleClick()}
        initial={false}
        animate={{
          width: isCircle ? cfg.circleWidth : stableWidth,
          height: cfg.height,
          backgroundColor: bg,
        }}
        style={{
          border,
          borderRadius: 9999,
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          padding: 0,
          flexShrink: 0,
        }}
        transition={{
          type: 'spring',
          stiffness: 200,
          damping: 15,
          mass: 1.2,
          backgroundColor: { duration: 0.2 },
        }}
        className={`ac-save-toggle ${className}`.trim()}
        data-status={status}
      >
        <AnimatePresence mode="popLayout">
          {status === 'idle' && (
            <motion.span
              key="idle"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12, x: -12 }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: cfg.text,
                color: isDark ? '#e4e4e7' : '#2c2a26',
                whiteSpace: 'nowrap',
              }}
            >
              {idleText}
            </motion.span>
          )}
          {status === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
              style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <motion.svg
                viewBox="0 0 26 26"
                width={cfg.spinner}
                height={cfg.spinner}
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
              >
                <circle cx="13" cy="13" r="10" stroke={isDark ? '#52525b' : '#d0ccc6'} strokeWidth="3" fill="none" />
                <path
                  d="M13 3 A10 10 0 0 1 23 13"
                  stroke={isDark ? '#a1a1aa' : '#ffffff'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                />
              </motion.svg>
            </motion.div>
          )}
          {(status === 'success' || status === 'saved') && (
            <motion.div
              key="check"
              layout
              initial={status === 'success' ? { opacity: 0, scale: 0.5, filter: 'blur(4px)' } : { opacity: 1 }}
              animate={
                status === 'success'
                  ? { opacity: 1, scale: 1.12, filter: 'blur(0px)' }
                  : { opacity: 1, scale: 1 }
              }
              exit={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: status === 'saved' ? '0 14px' : 0,
              }}
            >
              <svg width={cfg.icon} height={cfg.icon} viewBox="0 0 24 24" fill={checkColor} aria-hidden>
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.4-3.6-3.6 1.4-1.4 2.2 2.2 4.6-4.6 1.4 1.4-6 6z" />
              </svg>
              <AnimatePresence mode="popLayout">
                {status === 'saved' && (
                  <motion.span
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: 0.08 }}
                    style={{
                      fontWeight: 700,
                      fontSize: cfg.text,
                      color: isDark ? '#a1a1aa' : '#18181b',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {savedText}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </MotionConfig>
  );
};

export default SaveToggle;
