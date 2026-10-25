/**
 * Expandable QR block — show code + copy link.
 */
import { X, Link2, QrCode } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  MotionConfig,
  type Transition,
} from 'motion/react';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export interface ShowQrProps {
  value: string;
  buttonLabel?: string;
  onCopy?: () => void;
  className?: string;
  /** Start expanded (e.g. PC QR login panel). */
  defaultOpen?: boolean;
  /** Fires when expanded/collapsed — parent can start/stop QR session. */
  onOpenChange?: (open: boolean) => void;
}

export function ShowQr({
  value,
  buttonLabel = 'Afficher le QR',
  onCopy,
  className = '',
  defaultOpen = false,
  onOpenChange,
}: ShowQrProps) {
  const [isExpanded, setIsExpanded] = useState(defaultOpen);

  const setOpen = (open: boolean) => {
    setIsExpanded(open);
    onOpenChange?.(open);
  };
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) return;
    const t = setTimeout(() => setIsCopied(false), 2000);
    return () => clearTimeout(t);
  }, [isCopied]);

  // Keep open across value refresh only while user already expanded
  useEffect(() => {
    if (defaultOpen) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpen]);

  const springConfig: Transition = { type: 'spring', bounce: 0.22, duration: 0.4 };
  const collapsedTransition: Transition = { type: 'spring', bounce: 0.12, duration: 0.35 };

  return (
    <div className={`ac-show-qr ${className}`.trim()}>
      <MotionConfig transition={isExpanded ? springConfig : collapsedTransition}>
        <motion.div
          className="ac-show-qr-shell"
          initial={false}
          animate={{
            width: isExpanded ? 260 : 180,
            borderRadius: isExpanded ? 28 : 999,
          }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {!isExpanded ? (
              <motion.button
                key="collapsed"
                type="button"
                className="ac-show-qr-trigger"
                onClick={() => setOpen(true)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <QrCode size={22} />
                <span>{buttonLabel}</span>
              </motion.button>
            ) : (
              <motion.div
                key="expanded"
                className="ac-show-qr-expanded"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                <motion.div
                  className="ac-show-qr-frame"
                  initial={{ opacity: 0, y: 40, scale: 1.08 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                >
                  <QRCodeSVG
                    value={value}
                    size={180}
                    level="H"
                    fgColor="#0a0a0a"
                    bgColor="#ffffff"
                    className="ac-show-qr-svg"
                    imageSettings={{
                      src: '/atlas-icon-light.png',
                      height: 36,
                      width: 36,
                      excavate: true,
                    }}
                  />
                </motion.div>
                <div className="ac-show-qr-actions">
                  <button
                    type="button"
                    className="ac-show-qr-copy"
                    onClick={() => {
                      void navigator.clipboard.writeText(value);
                      setIsCopied(true);
                      onCopy?.();
                    }}
                  >
                    <Link2 size={18} />
                    <span>{isCopied ? 'Copié' : 'Copier'}</span>
                  </button>
                  <button
                    type="button"
                    className="ac-show-qr-close"
                    aria-label="Fermer"
                    onClick={() => {
                      setOpen(false);
                      setIsCopied(false);
                    }}
                  >
                    <X size={18} strokeWidth={2.4} color="#ffffff" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </MotionConfig>
    </div>
  );
}

export default ShowQr;
