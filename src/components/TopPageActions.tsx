import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Move page-level actions beside the floating dock only when they fit.
 * Without the desktop shell, or when space is tight, keep them in the page.
 */
export default function TopPageActions({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const widthHistory = useRef({ signature: '', maximum: 0 });

  // Run after each render: action labels and selection-dependent controls can change width.
  useLayoutEffect(() => {
    const actions = actionsRef.current;
    if (!actions) return;
    const slot = document.getElementById('desktop-catalog-actions');
    const column = slot?.closest('.ac-main-column') || slot?.parentElement;
    const dock = column?.querySelector<HTMLElement>('.ac-desktop-dock');
    const update = () => {
      let next: HTMLElement | null = null;
      if (enabled && slot && column && dock && window.innerWidth >= 1500) {
        const items = Array.from(actions.children) as HTMLElement[];
        const visible = items.filter(item => getComputedStyle(item).display !== 'none');
        const gap = parseFloat(getComputedStyle(actions).columnGap) || 0;
        const needed = visible.reduce((total, item) => {
          const style = getComputedStyle(item);
          return total + Math.max(item.getBoundingClientRect().width, item.scrollWidth)
            + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
        }, 0) + Math.max(0, visible.length - 1) * gap;
        // Keep the larger measurement to avoid bouncing on dynamic label updates;
        // reset when the controls change.
        const signature = visible.map(item => `${item.tagName}:${item.textContent}:${item.getAttribute('aria-label') || ''}`).join('|');
        if (widthHistory.current.signature !== signature) widthHistory.current = { signature, maximum: 0 };
        widthHistory.current.maximum = Math.max(widthHistory.current.maximum, needed);
        const columnWidth = column.getBoundingClientRect().width;
        // Reserve enough space for the expanded dock, including its hover scale.
        const dockWidth = Math.max(480, dock.getBoundingClientRect().width * 1.08);
        const available = columnWidth / 2 - dockWidth / 2 - 40;
        // Dock whenever there is enough room for the action strip; overflow scrolls horizontally inside the slot.
        if (needed > 0 && columnWidth > 0 && available >= 220) next = slot;
      }
      // Do not move a focused control out from under the keyboard user.
      if (next !== target && actions.contains(document.activeElement)) return;
      setTarget(previous => previous === next ? previous : next);
    };
    update();
    window.addEventListener('resize', update);
    actions.addEventListener('focusout', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(actions);
    if (column) observer?.observe(column);
    if (dock) observer?.observe(dock);
    for (const item of Array.from(actions.children)) observer?.observe(item);
    return () => {
      window.removeEventListener('resize', update);
      actions.removeEventListener('focusout', update);
      observer?.disconnect();
    };
  });

  const content = <div ref={actionsRef} className="dock-page-actions top-page-actions">{children}</div>;
  return <><span hidden className="dock-actions-placeholder" data-docked={!!target} />{target ? createPortal(content, target) : content}</>;
}
