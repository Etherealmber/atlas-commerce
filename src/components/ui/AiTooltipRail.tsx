/**
 * AI tooltip rail — vertical icon stack with sliding label tooltip
 * (Atlas Agent tools / quick actions).
 */
import { useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MessageCircle, Inbox, Sparkles, Command } from 'lucide-react';

export type AiTooltipItem = {
  id?: string;
  icon: ReactNode;
  label: string;
  /** Shortcut keys shown in tooltip, e.g. ['⌘','K'] */
  keys?: string[];
  hasBadge?: boolean;
  onClick?: () => void;
};

const DEFAULT_ITEMS: AiTooltipItem[] = [
  { id: 'chat', icon: <MessageCircle size={18} />, label: 'Discuter', keys: ['C'] },
  { id: 'inbox', icon: <Inbox size={18} />, label: 'Boîte', keys: ['I'], hasBadge: true },
  { id: 'agent', icon: <Sparkles size={18} />, label: 'Atlas Agent', keys: ['A'] },
];

export interface AiTooltipRailProps {
  items?: AiTooltipItem[];
  tooltipDelay?: number;
  className?: string;
}

export function AiTooltipRail({
  items = DEFAULT_ITEMS,
  tooltipDelay = 220,
  className = '',
}: AiTooltipRailProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [coords, setCoords] = useState({ clipPath: '', translateY: 0 });
  const measureRefs = useRef<(HTMLDivElement | null)[]>([]);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [isEntering, setIsEntering] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const calculatePosition = (index: number) => {
    const activeLabel = measureRefs.current[index];
    const activeIcon = buttonRefs.current[index];
    if (!activeLabel || !activeIcon) return null;
    const labelTop = activeLabel.offsetTop;
    const labelHeight = activeLabel.offsetHeight;
    const labelCenter = labelTop + labelHeight / 2;
    const iconTop = activeIcon.offsetTop;
    const iconHeight = activeIcon.offsetHeight;
    const iconCenter = iconTop + iconHeight / 2;
    const totalHeight = measureRefs.current.reduce(
      (acc, el) => acc + (el?.offsetHeight || 0),
      0,
    );
    if (!totalHeight) return null;
    const cTop = (labelTop / totalHeight) * 100;
    const cBottom = 100 - ((labelTop + labelHeight) / totalHeight) * 100;
    return {
      clipPath: `inset(${cTop}% 0 ${cBottom}% 0 round 8px)`,
      translateY: iconCenter - labelCenter,
    };
  };

  const handleMouseEnter = (index: number) => {
    const newCoords = calculatePosition(index);
    if (!newCoords) return;
    if (activeIndex === null) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setIsEntering(true);
      timeoutRef.current = setTimeout(() => {
        setCoords(newCoords);
        setActiveIndex(index);
      }, tooltipDelay);
    } else {
      setCoords(newCoords);
      setActiveIndex(index);
    }
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setActiveIndex(null);
    setCoords({ clipPath: '', translateY: 0 });
    setIsEntering(true);
  };

  return (
    <div className={`ac-ai-rail ${className}`.trim()} onMouseLeave={handleMouseLeave}>
      <AnimatePresence>
        {activeIndex !== null && coords.clipPath && (
          <motion.div
            className="ac-ai-rail-tooltip-host"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              className="ac-ai-rail-tooltip-bg"
              animate={{ clipPath: coords.clipPath, y: coords.translateY }}
              transition={{ type: 'spring', bounce: 0, duration: isEntering ? 0 : 0.35 }}
              onUpdate={() => {
                if (isEntering) setIsEntering(false);
              }}
            >
              <div className="ac-ai-rail-tooltip-stack">
                {items.map((item, index) => (
                  <div key={`tip-${item.id ?? index}`} className="ac-ai-rail-tooltip-row">
                    <span>{item.label}</span>
                    {item.hasBadge && (
                      <span className="ac-ai-rail-key">
                        <Command size={11} />
                      </span>
                    )}
                    {item.keys?.map((k, i) => (
                      <span key={i} className="ac-ai-rail-key">
                        {k}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ac-ai-rail-stack">
        {items.map((item, index) => (
          <button
            key={item.id ?? index}
            type="button"
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            className="ac-ai-rail-btn"
            onMouseEnter={() => handleMouseEnter(index)}
            onFocus={() => handleMouseEnter(index)}
            onClick={() => item.onClick?.()}
          >
            <span className="ac-ai-rail-ico">{item.icon}</span>
            <span className="sr-only">{item.label}</span>
          </button>
        ))}
      </div>

      {/* measure labels off-screen */}
      <div className="ac-ai-rail-measure" aria-hidden>
        {items.map((item, index) => (
          <div
            key={`m-${item.id ?? index}`}
            ref={(el) => {
              measureRefs.current[index] = el;
            }}
            className="ac-ai-rail-tooltip-row"
          >
            <span>{item.label}</span>
            {item.hasBadge && (
              <span className="ac-ai-rail-key">
                <Command size={11} />
              </span>
            )}
            {item.keys?.map((k, i) => (
              <span key={i} className="ac-ai-rail-key">
                {k}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default AiTooltipRail;
