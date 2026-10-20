/**
 * Collapsible details panel (width/height spring).
 */
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';

const SPRING = {
  type: 'spring' as const,
  stiffness: 200,
  damping: 22,
  mass: 1.2,
};

export type ExpandDetailRow = { label: string; value: string };

export interface ExpandDetailsProps {
  title?: string;
  rows?: ExpandDetailRow[];
  children?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function ExpandDetails({
  title = 'Détails',
  rows,
  children,
  defaultOpen = true,
  className = '',
}: ExpandDetailsProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <motion.div
      className={`ac-expand-details ${className}`.trim()}
      initial={false}
      animate={{
        borderRadius: isOpen ? 16 : 20,
      }}
      transition={SPRING}
    >
      <div className="ac-expand-details-inner">
        <button
          type="button"
          className="ac-expand-details-toggle"
          onClick={() => setIsOpen((v) => !v)}
          aria-expanded={isOpen}
        >
          <motion.span
            animate={{ rotate: isOpen ? 0 : -90 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="ac-expand-details-chevron"
          >
            <ChevronDown size={18} strokeWidth={2.2} />
          </motion.span>
          <span className="ac-expand-details-title">{title}</span>
        </button>

        <AnimatePresence initial={false} mode="popLayout">
          {isOpen && (
            <motion.div
              key="body"
              initial={{ opacity: 0, filter: 'blur(6px)', y: 16 }}
              animate={{
                opacity: 1,
                filter: 'blur(0px)',
                y: 0,
                transition: { type: 'spring', duration: 0.4, bounce: 0, delay: 0.08 },
              }}
              exit={{ opacity: 0, filter: 'blur(6px)', y: 10 }}
              transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
              className="ac-expand-details-body"
            >
              {children ? (
                children
              ) : (
                <div className="ac-expand-details-grid">
                  {(rows || []).map((r) => (
                    <div key={r.label} className="ac-expand-details-cell">
                      <div className="ac-expand-details-label">{r.label}</div>
                      <div className="ac-expand-details-value">{r.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default ExpandDetails;
