import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Normalize to HH:MM */
export function normalizeTime(v: string | null | undefined): string {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${pad(h)}:${pad(min)}`;
}

function usePopPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
  minW = 260,
) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: minW });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(minW, Math.min(300, r.width < 160 ? minW : r.width));
      let left = r.left;
      let top = r.bottom + 6;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      if (top + 320 > window.innerHeight - 8) top = Math.max(8, r.top - 326);
      setPos({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, triggerRef, popRef, minW]);
  return pos;
}

export type TimePickerProps = {
  value: string;
  onChange: (hhmm: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Minute step: 1 | 5 | 15 */
  step?: 1 | 5 | 15;
};

/**
 * Time picker — same interaction model as DatePicker:
 * secondary trigger + portal popover (atlas-dp-*), neutral (no primary green fills).
 */
export default function TimePicker({
  value,
  onChange,
  placeholder = 'Choisir une heure',
  disabled,
  id,
  className = '',
  step = 5,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopPosition(open, triggerRef, popRef, 260);

  const norm = normalizeTime(value);
  const [h, m] = norm ? norm.split(':').map(Number) : [9, 0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Scroll selected into view when opened
  useEffect(() => {
    if (!open || !popRef.current) return;
    const hourEl = popRef.current.querySelector('[data-tp-hour].is-selected');
    const minEl = popRef.current.querySelector('[data-tp-min].is-selected');
    hourEl?.scrollIntoView({ block: 'center' });
    minEl?.scrollIntoView({ block: 'center' });
  }, [open, norm]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.floor(60 / step) }, (_, i) => i * step);

  const pick = (nh: number, nm: number) => {
    onChange(`${pad(nh)}:${pad(nm)}`);
  };

  const now = () => {
    try {
      const s = new Date().toLocaleTimeString('fr-FR', {
        timeZone: 'Africa/Casablanca',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const n = normalizeTime(s.replace('h', ':'));
      if (n) {
        onChange(n);
        setOpen(false);
        return;
      }
    } catch {
      /* */
    }
    const d = new Date();
    onChange(`${pad(d.getHours())}:${pad(Math.floor(d.getMinutes() / step) * step)}`);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  const pop =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popRef}
            className="atlas-dp-pop atlas-tp-pop"
            style={{ top: pos.top, left: pos.left, width: pos.width, zIndex: 12050 }}
            role="dialog"
            aria-label="Choisir une heure"
          >
            <div className="atlas-tp-head">
              <span className="atlas-tp-head-label">Heure</span>
              <span className="atlas-tp-head-value">{norm || '——:——'}</span>
            </div>
            <div className="atlas-tp-cols">
              <div className="atlas-tp-col">
                <div className="atlas-tp-col-title">H</div>
                <div className="atlas-tp-scroll">
                  {hours.map((hh) => (
                    <button
                      key={hh}
                      type="button"
                      data-tp-hour
                      className={`atlas-tp-cell${hh === h && norm ? ' is-selected' : ''}`}
                      onClick={() => pick(hh, norm ? m : 0)}
                    >
                      {pad(hh)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="atlas-tp-col">
                <div className="atlas-tp-col-title">Min</div>
                <div className="atlas-tp-scroll">
                  {minutes.map((mm) => (
                    <button
                      key={mm}
                      type="button"
                      data-tp-min
                      className={`atlas-tp-cell${mm === m && norm ? ' is-selected' : ''}`}
                      onClick={() => pick(norm ? h : 9, mm)}
                    >
                      {pad(mm)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="atlas-dp-footer atlas-tp-footer">
              <button type="button" className="atlas-dp-btn" onClick={now}>
                Maintenant
              </button>
              <button type="button" className="atlas-dp-btn" onClick={clear}>
                Effacer
              </button>
              <button type="button" className="atlas-dp-btn is-primary-text" onClick={() => setOpen(false)}>
                OK
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        disabled={disabled}
        className={`atlas-dp-trigger atlas-tp-trigger ${className}`.trim()}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={norm ? 'atlas-dp-trigger-value' : 'atlas-dp-trigger-placeholder'}>
          {norm || placeholder}
        </span>
        <span className="atlas-tp-trigger-icon" aria-hidden>
          🕒
        </span>
      </button>
      {pop}
    </>
  );
}
