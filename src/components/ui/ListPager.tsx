import { type FC, type KeyboardEvent, useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Shared page mover for every list (Produits, Factures, Devis, Clients, Paie, Audit…).
 *
 * Numbered pager: ‹ 1 … 4 [5] 6 … 20 ›
 * - page is 0-based (as before); the UI is 1-based.
 * - totalPages, or total + pageSize, gives the page count.
 * - Cursor lists (no total) pass `hasMore`: only ‹ [N] › is shown.
 * - All colours come from CSS (`.ac-pager*` in App.css, light + dark). No inline paint.
 */
interface ListPagerProps {
  page: number;
  totalPages?: number;
  total?: number;
  pageSize?: number;
  /** Cursor pagination: there is a next page (total unknown). */
  hasMore?: boolean;
  /** Disable all controls (e.g. while a page is loading). */
  disabled?: boolean;
  onChange?: (page: number) => void;
  onPageChange?: (page: number) => void;
  size?: 'sm' | 'md';
  className?: string;
}

type Slot = number | 'gap-start' | 'gap-end';

/** Compact window of page numbers (1-based), always keeping first and last. */
export function pagerSlots(cur: number, tp: number, max = 7): Slot[] {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (tp <= max) return range(1, tp);
  // Near the start: 1 2 3 4 5 … 20
  if (cur <= max - 3) return [...range(1, max - 2), 'gap-end', tp];
  // Near the end: 1 … 16 17 18 19 20
  if (cur >= tp - (max - 4)) return [1, 'gap-start', ...range(tp - (max - 3), tp)];
  // Middle: 1 … 9 10 11 … 20
  const half = Math.floor((max - 4) / 2);
  return [1, 'gap-start', ...range(cur - half, cur + half), 'gap-end', tp];
}

const Chevron = ({ dir, size }: { dir: 'left' | 'right'; size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'}
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ListPager: FC<ListPagerProps> = ({
  page,
  totalPages,
  total,
  pageSize = 50,
  hasMore,
  disabled = false,
  onChange,
  onPageChange,
  size = 'md',
  className = '',
}) => {
  const setPage = onChange || onPageChange || (() => {});
  const reduceMotion = useReducedMotion();
  const indicatorId = useId();
  const cursorMode = totalPages == null && total == null && hasMore != null;
  const cur0 = Math.max(0, page | 0);
  const tp = cursorMode
    ? cur0 + 1 + (hasMore ? 1 : 0)
    : totalPages != null && totalPages > 0
      ? Math.max(1, Math.floor(totalPages))
      : Math.max(1, Math.ceil(Math.max(0, total ?? 0) / Math.max(1, pageSize)));
  const cur = Math.min(cur0 + 1, tp);
  const sm = size === 'sm';
  const canPrev = !disabled && cur > 1;
  const canNext = !disabled && cur < tp;
  const slots: Slot[] = cursorMode ? [cur] : pagerSlots(cur, tp, sm ? 5 : 7);

  const goTo = (n: number) => {
    if (disabled || n < 1 || n > tp || n === cur) return;
    setPage(n - 1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(cur - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(cur + 1); }
    else if (e.key === 'Home' && !cursorMode) { e.preventDefault(); goTo(1); }
    else if (e.key === 'End' && !cursorMode) { e.preventDefault(); goTo(tp); }
  };

  return (
    <nav
      className={`ac-pager${sm ? ' ac-pager--sm' : ''}${tp <= 1 ? ' is-single' : ''}${className ? ` ${className}` : ''}`}
      aria-label="Pagination"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="ac-pager-hit ac-pager-step"
        disabled={!canPrev}
        aria-label="Page précédente"
        onClick={() => goTo(cur - 1)}
      >
        <Chevron dir="left" size={sm ? 15 : 16} />
      </button>

      <ul className="ac-pager-pages">
        {slots.map((s) =>
          typeof s === 'number' ? (
            <li key={s}>
              <button
                type="button"
                className={`ac-pager-hit ac-pager-num${s === cur ? ' is-current' : ''}`}
                aria-label={`Page ${s}${cursorMode ? '' : ` sur ${tp}`}`}
                aria-current={s === cur ? 'page' : undefined}
                disabled={disabled && s !== cur}
                tabIndex={s === cur ? 0 : -1}
                onClick={() => goTo(s)}
              >
                {s === cur ? (
                  <motion.span
                    layoutId={`ac-pager-current-${indicatorId}`}
                    className="ac-pager-indicator"
                    aria-hidden="true"
                    transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38, mass: 0.6 }}
                  />
                ) : null}
                <span className="ac-pager-num-text">{s}</span>
              </button>
            </li>
          ) : (
            <li key={s} className="ac-pager-gap" aria-hidden="true">…</li>
          ),
        )}
      </ul>

      <button
        type="button"
        className="ac-pager-hit ac-pager-step"
        disabled={!canNext}
        aria-label="Page suivante"
        onClick={() => goTo(cur + 1)}
      >
        <Chevron dir="right" size={sm ? 15 : 16} />
      </button>

      <span className="ac-pager-sr" aria-live="polite">
        {cursorMode ? `Page ${cur}` : `Page ${cur} sur ${tp}`}
      </span>
    </nav>
  );
};

export default ListPager;
