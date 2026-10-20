/**
 * Quick paste field → resolved chip + continue (clients, email, barcode…).
 */
import React, { useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { X, ArrowRight } from 'lucide-react';

export interface PasteData {
  name: string;
  image?: string;
}

export interface QuickPasteProps {
  onPaste: (value: string) => PasteData | null | Promise<PasteData | null>;
  onClear?: () => void;
  onContinue?: (data: PasteData) => void;
  placeholder?: string;
  submitText?: string;
  className?: string;
}

export const QuickPaste: React.FC<QuickPasteProps> = ({
  onPaste,
  onClear,
  onContinue,
  placeholder = 'E-mail ou code…',
  submitText = 'Coller',
  className = '',
}) => {
  const [pastedData, setPastedData] = useState<PasteData | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [busy, setBusy] = useState(false);

  const handlePaste = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await onPaste(inputValue.trim());
      if (data) setPastedData(data);
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handlePaste();
    }
  };

  const handleClear = () => {
    setPastedData(null);
    setInputValue('');
    onClear?.();
  };

  const springConfig = { type: 'spring' as const, bounce: 0.1, duration: 0.4 };

  return (
    <div className={`ac-quick-paste ${className}`.trim()}>
      <LayoutGroup>
        <motion.div layout transition={springConfig} className="ac-quick-paste-shell">
          <AnimatePresence mode="popLayout">
            {pastedData ? (
              <motion.div key="pasted" className="ac-quick-paste-row">
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, filter: 'blur(4px)', x: -16 }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', x: 0 }}
                  exit={{ opacity: 0, scale: 0.92, filter: 'blur(4px)', x: -16 }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
                  className="ac-quick-paste-chip"
                >
                  {pastedData.image ? (
                    <img src={pastedData.image} alt="" className="ac-quick-paste-avatar" />
                  ) : (
                    <span className="ac-quick-paste-avatar ac-quick-paste-avatar--ini">
                      {(pastedData.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="ac-quick-paste-name">{pastedData.name}</span>
                  <button
                    type="button"
                    title="Retirer"
                    aria-label="Retirer"
                    onClick={handleClear}
                    className="ac-quick-paste-remove"
                  >
                    <X size={14} strokeWidth={3} />
                  </button>
                </motion.div>
                <motion.button
                  type="button"
                  title="Continuer"
                  aria-label="Continuer"
                  layoutId="ac-quick-paste-action"
                  transition={springConfig}
                  className="ac-quick-paste-continue"
                  onClick={() => onContinue?.(pastedData)}
                >
                  <ArrowRight size={20} strokeWidth={2.5} />
                </motion.button>
              </motion.div>
            ) : (
              <motion.div
                key="input"
                initial={{ opacity: 0, filter: 'blur(4px)' }}
                animate={{ opacity: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, filter: 'blur(4px)' }}
                transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
                className="ac-quick-paste-row ac-quick-paste-row--input"
              >
                <input
                  type="text"
                  placeholder={placeholder}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="ac-quick-paste-input"
                  autoComplete="off"
                />
                <motion.button
                  type="button"
                  layoutId="ac-quick-paste-action"
                  transition={springConfig}
                  className="ac-quick-paste-submit"
                  disabled={busy || !inputValue.trim()}
                  onClick={() => void handlePaste()}
                >
                  {busy ? '…' : submitText}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </LayoutGroup>
    </div>
  );
};

export default QuickPaste;
