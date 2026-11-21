import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'motion/react';

const spring = { type: 'spring' as const, duration: 0.35, bounce: 0 };

/**
 * Route enter — short opacity + lift (interruptible feel via spring).
 */
export default function PageTransition({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const location = useLocation();
  return (
    <motion.div
      key={location.key}
      className="page-anim"
      data-path={location.pathname}
      initial={disabled ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={disabled ? { duration: 0 } : spring}
    >
      {children}
    </motion.div>
  );
}
