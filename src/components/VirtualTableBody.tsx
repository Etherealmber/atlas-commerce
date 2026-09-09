import { useRef, useState, useEffect, type ReactNode } from 'react';

/**
 * Lightweight windowing for large tables (Phase 2 / 5).
 * Renders only ~rowHeight * overscan rows; keeps table semantics.
 * Listens to the nearest scroll parent (VirtualScroll wrapper).
 */
type Props<T> = {
  rows: T[];
  rowHeight?: number;
  overscan?: number;
  maxHeight?: number;
  renderRow: (row: T, index: number) => ReactNode;
  getKey: (row: T, index: number) => string | number;
};

export default function VirtualTableBody<T>({
  rows,
  rowHeight = 44,
  overscan = 8,
  maxHeight = 560,
  renderRow,
  getKey,
}: Props<T>) {
  const anchorRef = useRef<HTMLTableSectionElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const tbody = anchorRef.current;
    if (!tbody) return;
    let el: HTMLElement | null = tbody.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll' || el.classList.contains('atlas-virtual-scroll')) break;
      el = el.parentElement;
    }
    if (!el) return;
    const onScroll = () => setScrollTop(el!.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    setScrollTop(el.scrollTop);
    return () => el!.removeEventListener('scroll', onScroll);
  }, [rows.length]);

  // Small lists: no virtualization overhead
  if (rows.length <= 60) {
    return (
      <tbody ref={anchorRef}>
        {rows.map((row, i) => (
          <FragmentRow key={getKey(row, i)}>{renderRow(row, i)}</FragmentRow>
        ))}
      </tbody>
    );
  }

  const total = rows.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(maxHeight / rowHeight) + overscan * 2;
  const end = Math.min(rows.length, start + visibleCount);
  const padTop = start * rowHeight;
  const padBottom = Math.max(0, total - end * rowHeight);

  return (
    <tbody ref={anchorRef}>
      <tr aria-hidden>
        <td colSpan={20} style={{ padding: 0, border: 'none', height: padTop }} />
      </tr>
      {rows.slice(start, end).map((row, i) => (
        <FragmentRow key={getKey(row, start + i)}>{renderRow(row, start + i)}</FragmentRow>
      ))}
      <tr aria-hidden>
        <td colSpan={20} style={{ padding: 0, border: 'none', height: padBottom }} />
      </tr>
    </tbody>
  );
}

/** Wrapper so React accepts fragment-like single parent from renderRow which returns <tr> */
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Scroll container helper — wrap table with this when virtualizing */
export function VirtualScroll({
  maxHeight,
  children,
}: {
  maxHeight?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="table-wrap atlas-virtual-scroll"
      style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}
    >
      {children}
    </div>
  );
}
