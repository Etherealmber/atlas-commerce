/**
 * Time picker — same trigger, popover / bottom sheet and buttons as DatePicker
 * (ac-dp-*), with two scrolling columns (hours / minutes).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { PickerPortal, emitEdit, usePickerPopover } from './DatePicker';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Normalize to HH:MM */
function normalizeTime(v: string | null | undefined): string {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${pad(h)}:${pad(min)}`;
}

type TimePickerProps = {
  value: string;
  onChange: (hhmm: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Minute step: 1 | 5 | 15 */
  step?: 1 | 5 | 15;
  size?: 'md' | 'sm';
};

export default function TimePicker({
  value,
  onChange,
  placeholder = 'Choisir une heure',
  disabled,
  id,
  className = '',
  step = 5,
  size = 'md',
}: TimePickerProps) {
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback((v: boolean) => setOpenState(v), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const { style, sheet } = usePickerPopover(open, setOpen, triggerRef, popRef);

  const norm = normalizeTime(value);
  const [h, m] = norm ? norm.split(':').map(Number) : [9, 0];

  // Centre the selected cells when opened.
  useEffect(() => {
    if (!open || !popRef.current) return;
    popRef.current.querySelectorAll<HTMLElement>('.ac-tp-cell.is-selected').forEach((el) => {
      const col = el.parentElement;
      if (col) col.scrollTop = el.offsetTop - col.clientHeight / 2 + el.offsetHeight / 2;
    });
  }, [open, norm]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.floor(60 / step) }, (_, i) => i * step);

  const pick = (nh: number, nm: number) => {
    onChange(`${pad(nh)}:${pad(nm)}`);
    emitEdit(triggerRef.current);
  };

  const now = () => {
    let next = '';
    try {
      const s = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', hour12: false });
      next = normalizeTime(s.replace('h', ':'));
    } catch {
      next = '';
    }
    if (!next) {
      const d = new Date();
      next = `${pad(d.getHours())}:${pad(Math.floor(d.getMinutes() / step) * step)}`;
    }
    onChange(next);
    emitEdit(triggerRef.current);
    setOpen(false);
  };

  return (
    <div className={`ac-dp ac-tp ${className}`.trim()}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        disabled={disabled}
        className={`ac-pick ac-dp-trigger size-${size}${open ? ' is-open' : ''}`}
        onClick={() => !disabled && setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={`ac-dp-value${norm ? '' : ' is-placeholder'}`}>{norm || placeholder}</span>
        <Clock3 className="ac-dp-icon" size={17} strokeWidth={1.9} aria-hidden />
      </button>
      <PickerPortal open={open} popRef={popRef} style={style} sheet={sheet} label="Choisir une heure" className="is-time" onClose={() => setOpen(false)}>
        <div className="ac-tp-head">
          <span className="ac-tp-label">Heure</span>
          <span className="ac-tp-value">{norm || '--:--'}</span>
        </div>
        <div className="ac-tp-cols">
          <div className="ac-tp-col" role="listbox" aria-label="Heures">
            {hours.map((hh) => (
              <button key={hh} type="button" role="option" aria-selected={hh === h && !!norm} className={`ac-pick ac-tp-cell${hh === h && norm ? ' is-selected' : ''}`} onClick={() => pick(hh, norm ? m : 0)}>
                {pad(hh)}
              </button>
            ))}
          </div>
          <div className="ac-tp-col" role="listbox" aria-label="Minutes">
            {minutes.map((mm) => (
              <button key={mm} type="button" role="option" aria-selected={mm === m && !!norm} className={`ac-pick ac-tp-cell${mm === m && norm ? ' is-selected' : ''}`} onClick={() => pick(norm ? h : 9, mm)}>
                {pad(mm)}
              </button>
            ))}
          </div>
        </div>
        <div className="ac-dp-foot">
          <button type="button" className="ac-pick ac-dp-btn is-ghost" onClick={() => { onChange(''); emitEdit(triggerRef.current); setOpen(false); }}>Effacer</button>
          <button type="button" className="ac-pick ac-dp-btn" onClick={now}>Maintenant</button>
          <button type="button" className="ac-pick ac-dp-btn is-primary" onClick={() => setOpen(false)}>OK</button>
        </div>
      </PickerPortal>
    </div>
  );
}
