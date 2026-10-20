import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const WEEKDAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function parseISO(v: string | undefined | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDisplay(iso: string): string {
  const d = parseISO(iso);
  if (!d) return '';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatRange(from: string, to: string): string {
  const a = formatDisplay(from);
  const b = formatDisplay(to);
  if (a && b) return `${a} — ${b}`;
  return a || b || '';
}

function dayCells(view: Date): (Date | null)[] {
  const first = startOfMonth(view);
  const startPad = (first.getDay() + 6) % 7;
  const days: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  const dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) days.push(new Date(view.getFullYear(), view.getMonth(), d));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function usePopPosition(open: boolean, triggerRef: RefObject<HTMLElement | null>, popRef: RefObject<HTMLElement | null>, minW = 280) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: minW });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(minW, Math.min(340, r.width < 200 ? minW : r.width));
      let left = r.left;
      let top = r.bottom + 6;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      if (top + 340 > window.innerHeight - 8) top = Math.max(8, r.top - 346);
      setPos({ top, left, width });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      // close handled by parent via callback — attach on document in parent
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, triggerRef, popRef, minW]);
  return pos;
}

export type DatePickerProps = {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  min?: string;
  max?: string;
  /** First year in dropdown (default 1910 — birthdays, founding dates, etc.) */
  minYear?: number;
  /** Last year in dropdown (default current year + 10) */
  maxYear?: number;
  size?: 'md' | 'sm';
};

/** Single-date calendar — neutral secondary UI (no filled primary circles). */
export default function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = 'Choisir une date',
  className = '',
  id,
  min,
  max,
  minYear = 1910,
  maxYear,
  size = 'md',
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const selected = parseISO(value);
  const [view, setView] = useState<Date>(() => startOfMonth(selected || new Date()));
  const pos = usePopPosition(open, triggerRef, popRef, 280);
  const minD = parseISO(min || '');
  const maxD = parseISO(max || '');

  useEffect(() => {
    if (selected) setView(startOfMonth(selected));
  }, [value]);

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

  const cells = useMemo(() => dayCells(view), [view]);
  const today = new Date();
  const isDisabledDay = (d: Date) => {
    if (minD && d < new Date(minD.getFullYear(), minD.getMonth(), minD.getDate())) return true;
    if (maxD && d > new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate())) return true;
    return false;
  };

  const pop =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popRef}
            className="atlas-dp-pop"
            style={{ top: pos.top, left: pos.left, width: pos.width, zIndex: 100100 }}
            role="dialog"
            aria-label="Calendrier"
          >
            <CalendarMonth
              view={view}
              setView={setView}
              cells={cells}
              selected={selected}
              hover={null}
              rangeStart={null}
              rangeEnd={null}
              today={today}
              isDisabledDay={isDisabledDay}
              minYear={minYear}
              maxYear={maxYear ?? new Date().getFullYear() + 10}
              onPick={(d) => {
                onChange(toISO(d));
                setOpen(false);
              }}
            />
            <div className="atlas-dp-foot">
              <button
                type="button"
                className="atlas-dp-btn secondary"
                onClick={() => {
                  const t = new Date();
                  if (!isDisabledDay(t)) {
                    onChange(toISO(t));
                    setOpen(false);
                  }
                }}
              >
                Aujourd&apos;hui
              </button>
              {value ? (
                <button type="button" className="atlas-dp-btn secondary" onClick={() => { onChange(''); setOpen(false); }}>
                  Effacer
                </button>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`atlas-dp ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={`atlas-dp-trigger secondary size-${size}${open ? ' is-open' : ''}`}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={`atlas-dp-value${value ? '' : ' is-placeholder'}`}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        <svg className="atlas-dp-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </button>
      {pop}
    </div>
  );
}

function yearOptions(minY: number, maxY: number): number[] {
  const a = Math.min(minY, maxY);
  const b = Math.max(minY, maxY);
  const out: number[] = [];
  for (let y = b; y >= a; y--) out.push(y); // newest first
  return out;
}

function CalendarMonth({
  view,
  setView,
  cells,
  selected,
  hover,
  rangeStart,
  rangeEnd,
  today,
  isDisabledDay,
  onPick,
  onHover,
  minYear = 1910,
  maxYear,
}: {
  view: Date;
  setView: (d: Date) => void;
  cells: (Date | null)[];
  selected: Date | null;
  hover: Date | null;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  today: Date;
  isDisabledDay: (d: Date) => boolean;
  onPick: (d: Date) => void;
  onHover?: (d: Date | null) => void;
  minYear?: number;
  maxYear?: number;
}) {
  const yMax = maxYear ?? new Date().getFullYear() + 10;
  const yMin = minYear;
  const years = yearOptions(yMin, yMax);
  const inRange = (d: Date) => {
    if (!rangeStart) return false;
    const end = rangeEnd || hover;
    if (!end) return false;
    const a = rangeStart <= end ? rangeStart : end;
    const b = rangeStart <= end ? end : rangeStart;
    const t = d.getTime();
    return t >= a.getTime() && t <= b.getTime();
  };

  return (
    <div className="atlas-dp-cal">
      <div className="atlas-dp-head">
        <button
          type="button"
          className="atlas-dp-nav secondary"
          aria-label="Mois précédent"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
        >
          ‹
        </button>
        <div className="atlas-dp-title">
          <select
            className="atlas-dp-select"
            value={view.getMonth()}
            onChange={(e) => setView(new Date(view.getFullYear(), Number(e.target.value), 1))}
            aria-label="Mois"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i}>{m}</option>
            ))}
          </select>
          <select
            className="atlas-dp-select"
            value={view.getFullYear()}
            onChange={(e) => setView(new Date(Number(e.target.value), view.getMonth(), 1))}
            aria-label="Année"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="atlas-dp-nav secondary"
          aria-label="Mois suivant"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
        >
          ›
        </button>
      </div>
      <div className="atlas-dp-weekdays">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="atlas-dp-grid">
        {cells.map((d, i) =>
          d ? (
            <button
              key={i}
              type="button"
              className={[
                'atlas-dp-day',
                selected && sameDay(d, selected) ? 'is-selected' : '',
                rangeStart && sameDay(d, rangeStart) ? 'is-selected' : '',
                rangeEnd && sameDay(d, rangeEnd) ? 'is-selected' : '',
                inRange(d) ? 'is-in-range' : '',
                sameDay(d, today) ? 'is-today' : '',
                isDisabledDay(d) ? 'is-disabled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={isDisabledDay(d)}
              onMouseEnter={() => onHover?.(d)}
              onMouseLeave={() => onHover?.(null)}
              onClick={() => onPick(d)}
            >
              {d.getDate()}
            </button>
          ) : (
            <span key={i} className="atlas-dp-day is-empty" />
          ),
        )}
      </div>
    </div>
  );
}

export type DateRangePickerProps = {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  disabled?: boolean;
  className?: string;
  size?: 'md' | 'sm';
  /** Preset ranges shown on the left (dashboard-style) */
  showPresets?: boolean;
};

/** Range picker — dual-step selection + optional presets (daterangepicker-like). */
export function DateRangePicker({
  from,
  to,
  onChange,
  disabled,
  className = '',
  size = 'md',
  showPresets = true,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const start = parseISO(from);
  const end = parseISO(to);
  const [view, setView] = useState<Date>(() => startOfMonth(start || new Date()));
  const [picking, setPicking] = useState<'start' | 'end'>('start');
  const [draftStart, setDraftStart] = useState<Date | null>(start);
  const [draftEnd, setDraftEnd] = useState<Date | null>(end);
  const [hover, setHover] = useState<Date | null>(null);
  const pos = usePopPosition(open, triggerRef, popRef, showPresets ? 420 : 300);

  useEffect(() => {
    if (open) {
      setDraftStart(start);
      setDraftEnd(end);
      setPicking('start');
      setView(startOfMonth(start || new Date()));
    }
  }, [open]);

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

  const cells = useMemo(() => dayCells(view), [view]);
  const today = new Date();

  const applyPreset = (key: number | 'today' | 'yesterday' | 'month' | 'lastMonth') => {
    const endD = new Date();
    endD.setHours(0, 0, 0, 0);
    let startD = new Date(endD);
    if (key === 'today') {
      /* same day */
    } else if (key === 'yesterday') {
      startD.setDate(endD.getDate() - 1);
      endD.setDate(endD.getDate() - 1);
    } else if (key === 'month') {
      startD = new Date(endD.getFullYear(), endD.getMonth(), 1);
    } else if (key === 'lastMonth') {
      startD = new Date(endD.getFullYear(), endD.getMonth() - 1, 1);
      const e2 = new Date(endD.getFullYear(), endD.getMonth(), 0);
      onChange(toISO(startD), toISO(e2));
      setOpen(false);
      return;
    } else if (typeof key === 'number') {
      startD.setDate(endD.getDate() - key);
    }
    onChange(toISO(startD), toISO(endD));
    setOpen(false);
  };

  const onPick = (d: Date) => {
    if (picking === 'start') {
      setDraftStart(d);
      setDraftEnd(null);
      setPicking('end');
    } else {
      let a = draftStart || d;
      let b = d;
      if (b < a) {
        const t = a;
        a = b;
        b = t;
      }
      setDraftStart(a);
      setDraftEnd(b);
      onChange(toISO(a), toISO(b));
      setOpen(false);
    }
  };

  const pop =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popRef}
            className={`atlas-dp-pop atlas-dp-range${showPresets ? ' has-presets' : ''}`}
            style={{ top: pos.top, left: pos.left, width: pos.width, zIndex: 100100 }}
            role="dialog"
            aria-label="Période"
          >
            {showPresets && (
              <div className="atlas-dp-presets">
                <button type="button" className="atlas-dp-preset" onClick={() => applyPreset('today')}>Aujourd&apos;hui</button>
                <button type="button" className="atlas-dp-preset" onClick={() => applyPreset('yesterday')}>Hier</button>
                <button type="button" className="atlas-dp-preset" onClick={() => applyPreset(6)}>7 derniers jours</button>
                <button type="button" className="atlas-dp-preset" onClick={() => applyPreset(29)}>30 derniers jours</button>
                <button type="button" className="atlas-dp-preset" onClick={() => applyPreset('month')}>Ce mois</button>
                <button type="button" className="atlas-dp-preset" onClick={() => applyPreset('lastMonth')}>Mois dernier</button>
                <button type="button" className="atlas-dp-preset is-active">Personnalisé</button>
              </div>
            )}
            <div className="atlas-dp-range-main">
              <p className="atlas-dp-hint">
                {picking === 'start' ? 'Choisissez la date de début' : 'Choisissez la date de fin'}
              </p>
              <CalendarMonth
                view={view}
                setView={setView}
                cells={cells}
                selected={null}
                hover={hover}
                rangeStart={draftStart}
                rangeEnd={draftEnd}
                today={today}
                isDisabledDay={() => false}
                minYear={1910}
                maxYear={new Date().getFullYear() + 10}
                onPick={onPick}
                onHover={setHover}
              />
              <div className="atlas-dp-foot">
                <button type="button" className="atlas-dp-btn secondary" onClick={() => setOpen(false)}>
                  Annuler
                </button>
                <button
                  type="button"
                  className="atlas-dp-btn secondary"
                  onClick={() => {
                    const t = new Date();
                    onChange(toISO(t), toISO(t));
                    setOpen(false);
                  }}
                >
                  Aujourd&apos;hui
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`atlas-dp atlas-dp-range-wrap ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className={`atlas-dp-trigger secondary size-${size}${open ? ' is-open' : ''}`}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={`atlas-dp-value${from || to ? '' : ' is-placeholder'}`}>
          {formatRange(from, to) || 'Choisir une période'}
        </span>
        <svg className="atlas-dp-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </button>
      {pop}
    </div>
  );
}
