import {
  type FC,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';

export interface ListPagerProps {
  page: number;
  totalPages?: number;
  total?: number;
  pageSize?: number;
  pageBase?: number;
  onChange?: (page: number) => void;
  onPageChange?: (page: number) => void;
  size?: 'sm' | 'md';
  className?: string;
}

function DigitSlot({ char, dir }: { char: string; dir: 1 | -1 }) {
  return (
    <span className="ac-pager-digit">
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span
          key={char}
          className="ac-pager-digit-inner"
          custom={dir}
          initial={(d: number) => ({ y: d > 0 ? 12 : -12, opacity: 0 })}
          animate={{ y: 0, opacity: 1 }}
          exit={(d: number) => ({ y: d > 0 ? -12 : 12, opacity: 0 })}
          transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.65 }}
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function AnimatedNumber({ value, dir }: { value: number; dir: 1 | -1 }) {
  const str = String(Math.max(0, value | 0));
  return (
    <span className="ac-pager-num" aria-hidden>
      {str.split('').map((c, i) => (
        <DigitSlot key={`d${i}`} char={c} dir={dir} />
      ))}
    </span>
  );
}

/**
 * Arrow matches reference video:
 * - idle = white circle, dark icon
 * - mouse over OR press = black circle, white icon
 * - leave / release = white again (never sticks)
 */
function PagerArrow({
  disabled,
  label,
  onClick,
  children,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const hoverRef = useRef(false);
  const pressRef = useRef(false);

  const apply = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const on = !disabled && (hoverRef.current || pressRef.current);
    el.setAttribute('data-filled', on ? '1' : '0');
    // White idle · black only while active · disabled = white + muted icon (not solid gray)
    if (disabled) {
      el.style.setProperty('background', '#ffffff', 'important');
      el.style.setProperty('color', '#a1a1aa', 'important');
      el.style.setProperty('opacity', '0.55', 'important');
      el.style.setProperty('box-shadow', '0 1px 2px rgba(15,23,42,0.04)', 'important');
    } else {
      el.style.setProperty('background', on ? '#0a0a0a' : '#ffffff', 'important');
      el.style.setProperty('color', on ? '#ffffff' : '#0a0a0a', 'important');
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('box-shadow', on ? 'none' : '0 1px 2px rgba(15,23,42,0.06)', 'important');
    }
    el.style.setProperty('filter', 'none', 'important');
  }, [disabled]);

  useEffect(() => { apply(); }, [apply, disabled]);

  const onPointerEnter = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse') {
      hoverRef.current = true;
      apply();
    }
  };
  const onPointerLeave = () => {
    hoverRef.current = false;
    pressRef.current = false;
    apply();
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    pressRef.current = true;
    apply();
    // Capture so we get pointerup even if released outside
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
  };
  const onPointerUp = () => {
    pressRef.current = false;
    // Keep hover fill if mouse still over
    apply();
  };
  const onPointerCancel = () => {
    hoverRef.current = false;
    pressRef.current = false;
    apply();
  };

  return (
    <button
      ref={btnRef}
      type="button"
      className="ac-pager-hit"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        minWidth: 32,
        padding: 0,
        border: 'none',
        borderRadius: 999,
        background: '#ffffff',
        color: '#0a0a0a',
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease',
        WebkitAppearance: 'none',
        appearance: 'none',
        outline: 'none',
      }}
    >
      {children}
    </button>
  );
}

export const ListPager: FC<ListPagerProps> = ({
  page,
  totalPages,
  total,
  pageSize = 50,
  onChange,
  onPageChange,
  size = 'md',
  className = '',
}) => {
  const setPage = onChange || onPageChange || (() => {});
  const tp =
    totalPages != null && totalPages > 0
      ? Math.max(1, Math.floor(totalPages))
      : Math.max(1, Math.ceil(Math.max(0, total ?? 0) / Math.max(1, pageSize)));
  const cur = Math.min(Math.max(1, (page | 0) + 1), tp);
  const sm = size === 'sm';
  const icon = sm ? 16 : 18;
  const [dir, setDir] = useState<1 | -1>(1);

  const go = (delta: number) => {
    const next = page + delta;
    if (next < 0 || next >= tp) return;
    setDir(delta > 0 ? 1 : -1);
    setPage(next);
  };

  return (
    <div
      className={`ac-pager${sm ? ' ac-pager--sm' : ''}${className ? ` ${className}` : ''}`}
      role="navigation"
      aria-label="Pagination"
    >
      <PagerArrow disabled={page <= 0} label="Page précédente" onClick={() => go(-1)}>
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </PagerArrow>

      <div className="ac-pager-label" aria-live="polite">
        <span className="ac-pager-sr">
          Page {cur} sur {tp}
        </span>
        <AnimatedNumber value={cur} dir={dir} />
        <span className="ac-pager-of">sur</span>
        <AnimatedNumber value={tp} dir={1} />
      </div>

      <PagerArrow disabled={page >= tp - 1} label="Page suivante" onClick={() => go(1)}>
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M9 18l6-6-6-6"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </PagerArrow>
    </div>
  );
};

export default ListPager;
