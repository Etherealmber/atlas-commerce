import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export type RowAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
};

/**
 * « ⋯ » overflow menu for table rows: keeps the row to one or two visible
 * actions (so the table never needs a horizontal scrollbar, even with the
 * sidebar open) and lists the rest in a small popover.
 *
 * Rendered in a portal with fixed positioning, so the table's scroll
 * container can't clip it. Escape / outside click / scroll close it; arrow
 * keys move between items.
 */
export function RowActionsMenu({ actions, label = 'Plus d’actions' }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = actions.filter(Boolean);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const menuH = menuRef.current?.offsetHeight || visible.length * 38 + 12;
    const menuW = menuRef.current?.offsetWidth || 220;
    const up = b.bottom + menuH + 8 > window.innerHeight && b.top > menuH + 8;
    const rtl = document.documentElement.dir === 'rtl';
    const left = rtl ? Math.max(8, b.left) : Math.max(8, Math.min(window.innerWidth - menuW - 8, b.right - menuW));
    setPos({ top: up ? b.top - menuH - 6 : b.bottom + 6, left, up });
  }, [visible.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return close();
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        btnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    // Focus the first item for keyboard users.
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!visible.length) return null;

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="secondary ac-row-more"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={id}
          role="menu"
          className={`ac-row-menu${pos?.up ? ' is-up' : ''}`}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          onKeyDown={onMenuKey}
        >
          {visible.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              className={`ac-row-menu-item${a.tone === 'danger' ? ' is-danger' : ''}`}
              disabled={a.disabled}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
            >
              {a.icon ? <span className="ac-row-menu-ico" aria-hidden="true">{a.icon}</span> : null}
              <span>{a.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export default RowActionsMenu;
