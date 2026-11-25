/**
 * Date pickers (v0.9.3 rewrite) — one look for every date field of the web app.
 *
 *  • DatePicker       single date  (value 'YYYY-MM-DD')
 *  • DateRangePicker  period with presets (from / to 'YYYY-MM-DD')
 *  • MonthPicker      month        (value 'YYYY-MM') — replaces <input type="month">
 *
 * Trigger = same field as the inputs around it. Popover = neutral card with
 * round day cells, month / year grids (no native selects), pill buttons and
 * full keyboard support. On phones the popover becomes a bottom sheet.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { getLang, intlLocale, useLang } from '../i18n/core';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_GRID = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const SHEET_MAX_W = 560;

// ── Date helpers ─────────────────────────────────────────────────────────────

export function parseISO(v: string | undefined | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const toISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
};
const sameDay = (a: Date | null, b: Date | null) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
const todayDate = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };

function formatDisplay(iso: string): string {
  const d = parseISO(iso);
  return d ? getLang() === 'fr' ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(d) : '';
}

function formatRange(from: string, to: string): string {
  const a = parseISO(from);
  const b = parseISO(to);
  if (a && b) {
    const left = a.getFullYear() === b.getFullYear() ? (getLang() === 'fr' ? `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]}` : new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short' }).format(a)) : formatDisplay(from);
    return `${left} — ${formatDisplay(to)}`;
  }
  return formatDisplay(from) || formatDisplay(to);
}

/** 6 weeks starting on Monday, including the days of the adjacent months. */
function monthCells(view: Date): Date[] {
  const first = startOfMonth(view);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Let form-level listeners (unsaved-changes guard) see picker edits. */
export function emitEdit(el: HTMLElement | null) {
  el?.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── Popover placement (shared with TimePicker) ──────────────────────────────

export function usePickerPopover(open: boolean, setOpen: (v: boolean) => void, triggerRef: RefObject<HTMLElement | null>, popRef: RefObject<HTMLElement | null>) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const [sheet, setSheet] = useState(false);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const trigger = triggerRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw < SHEET_MAX_W) {
        setSheet(true);
        setStyle({ left: 8, right: 8, bottom: 8, top: 'auto' });
        return;
      }
      setSheet(false);
      const r = trigger.getBoundingClientRect();
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      let left = r.left;
      if (left + pw > vw - 8) left = Math.max(8, r.right - pw);
      let top = r.bottom + 8;
      if (top + ph > vh - 8) top = r.top - 8 - ph >= 8 ? r.top - 8 - ph : Math.max(8, vh - 8 - ph);
      setStyle({ left, top });
    };
    place();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (popRef.current) ro?.observe(popRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, triggerRef, popRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Capture: Escape closes the picker only — never the dialog behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, setOpen, triggerRef, popRef]);

  return { style, sheet };
}

/** Portal shell: card (or bottom sheet + scrim on phones). */
export function PickerPortal({ open, popRef, style, sheet, label, className = '', onClose, children }: {
  open: boolean;
  popRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
  sheet: boolean;
  label: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <>
      {sheet ? <div className="ac-dp-scrim" aria-hidden onMouseDown={onClose} /> : null}
      <div
        ref={popRef}
        className={`ac-dp-pop${sheet ? ' is-sheet' : ''} ${className}`.trim()}
        style={{ ...style, position: 'fixed', zIndex: 100100 }}
        role="dialog"
        aria-label={label}
      >
        {sheet ? <span className="ac-dp-grabber" aria-hidden /> : null}
        {children}
      </div>
    </>,
    document.body,
  );
}

function Trigger({ triggerRef, id, open, disabled, size, className, placeholder, text, onToggle, icon }: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  id?: string;
  open: boolean;
  disabled?: boolean;
  size: 'md' | 'sm';
  className: string;
  placeholder: string;
  text: string;
  onToggle: () => void;
  icon?: ReactNode;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      id={id}
      className={`ac-pick ac-dp-trigger size-${size}${open ? ' is-open' : ''} ${className}`.trim()}
      disabled={disabled}
      onClick={onToggle}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <span className={`ac-dp-value${text ? '' : ' is-placeholder'}`}>{text || placeholder}</span>
      {icon ?? <CalendarDays className="ac-dp-icon" size={17} strokeWidth={1.9} aria-hidden />}
    </button>
  );
}

// ── Month / year grids ───────────────────────────────────────────────────────

function MonthGrid({ year, setYear, current, minYear, maxYear, onPick, isDisabled, onYearTitle }: {
  year: number;
  setYear: (y: number) => void;
  current: { y: number; m: number } | null;
  minYear: number;
  maxYear: number;
  onPick: (m: number) => void;
  isDisabled?: (y: number, m: number) => boolean;
  onYearTitle?: () => void;
}) {
  const lang = useLang();
  const now = new Date();
  return (
    <div className="ac-dp-panel">
      <div className="ac-dp-head">
        <button type="button" className="ac-pick ac-dp-nav" aria-label="Année précédente" disabled={year <= minYear} onClick={() => setYear(year - 1)}><ChevronLeft size={17} aria-hidden /></button>
        <button type="button" className="ac-pick ac-dp-title" onClick={onYearTitle} disabled={!onYearTitle} aria-label="Choisir l’année">
          {year}{onYearTitle ? <ChevronDown size={15} aria-hidden /> : null}
        </button>
        <button type="button" className="ac-pick ac-dp-nav" aria-label="Année suivante" disabled={year >= maxYear} onClick={() => setYear(year + 1)}><ChevronRight size={17} aria-hidden /></button>
      </div>
      <div className="ac-dp-months">
        {MONTHS.map((monthName, m) => {
          const selected = !!current && current.y === year && current.m === m;
          const isNow = now.getFullYear() === year && now.getMonth() === m;
          return (
            <button
              key={monthName}
              type="button"
              aria-label={`${monthName} ${year}`}
              className={`ac-pick ac-dp-month${selected ? ' is-selected' : ''}${isNow ? ' is-today' : ''}`}
              disabled={isDisabled?.(year, m)}
              aria-pressed={selected}
              onClick={() => onPick(m)}
            >
              {lang === 'fr' ? MONTHS_GRID[m] : new Intl.DateTimeFormat(intlLocale(lang), { month: 'short' }).format(new Date(year, m, 1))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function YearGrid({ year, minYear, maxYear, current, onPick }: {
  year: number;
  minYear: number;
  maxYear: number;
  current: number | null;
  onPick: (y: number) => void;
}) {
  const [page, setPage] = useState(() => Math.floor((year - minYear) / 12));
  const first = minYear + page * 12;
  const years = Array.from({ length: 12 }, (_, i) => first + i).filter((y) => y <= maxYear);
  const pages = Math.ceil((maxYear - minYear + 1) / 12);
  const thisYear = new Date().getFullYear();
  return (
    <div className="ac-dp-panel">
      <div className="ac-dp-head">
        <button type="button" className="ac-pick ac-dp-nav" aria-label="Années précédentes" disabled={page <= 0} onClick={() => setPage(page - 1)}><ChevronLeft size={17} aria-hidden /></button>
        <span className="ac-pick ac-dp-title is-static">{years[0]} – {years[years.length - 1]}</span>
        <button type="button" className="ac-pick ac-dp-nav" aria-label="Années suivantes" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={17} aria-hidden /></button>
      </div>
      <div className="ac-dp-months">
        {years.map((y) => (
          <button key={y} type="button" className={`ac-pick ac-dp-month${current === y ? ' is-selected' : ''}${thisYear === y ? ' is-today' : ''}`} aria-pressed={current === y} onClick={() => onPick(y)}>
            {y}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Day calendar ─────────────────────────────────────────────────────────────

type CalendarProps = {
  view: Date;
  setView: (d: Date) => void;
  selected?: Date | null;
  rangeStart?: Date | null;
  rangeEnd?: Date | null;
  hover?: Date | null;
  setHover?: (d: Date | null) => void;
  isDisabled: (d: Date) => boolean;
  onPick: (d: Date) => void;
  minYear: number;
  maxYear: number;
  autoFocus?: boolean;
};

function Calendar({ view, setView, selected = null, rangeStart = null, rangeEnd = null, hover = null, setHover, isDisabled, onPick, minYear, maxYear, autoFocus = true }: CalendarProps) {
  const lang = useLang();
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const [focus, setFocus] = useState<Date>(() => selected || rangeStart || (sameMonth(todayDate(), view) ? todayDate() : view));
  const gridRef = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => monthCells(view), [view]);
  const today = todayDate();

  useEffect(() => {
    if (mode !== 'days' || !autoFocus) return;
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${toISO(focus)}"]`);
    el?.focus({ preventScroll: true });
  }, [focus, mode, autoFocus]);

  const moveFocus = (d: Date) => {
    setFocus(d);
    if (!sameMonth(d, view)) setView(startOfMonth(d));
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focus, lang === 'ar' ? 1 : -1),
      ArrowRight: () => addDays(focus, lang === 'ar' ? -1 : 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => addDays(focus, -((focus.getDay() + 6) % 7)),
      End: () => addDays(focus, 6 - ((focus.getDay() + 6) % 7)),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
    };
    if (map[e.key]) {
      e.preventDefault();
      moveFocus(map[e.key]());
    }
  };

  const end = rangeEnd || (rangeStart && hover ? hover : null);
  const lo = rangeStart && end ? (rangeStart <= end ? rangeStart : end) : null;
  const hi = rangeStart && end ? (rangeStart <= end ? end : rangeStart) : null;

  if (mode === 'months') {
    return (
      <MonthGrid
        year={view.getFullYear()}
        setYear={(y) => setView(new Date(y, view.getMonth(), 1))}
        current={{ y: view.getFullYear(), m: view.getMonth() }}
        minYear={minYear}
        maxYear={maxYear}
        onYearTitle={() => setMode('years')}
        onPick={(m) => { setView(new Date(view.getFullYear(), m, 1)); setFocus(new Date(view.getFullYear(), m, 1)); setMode('days'); }}
      />
    );
  }
  if (mode === 'years') {
    return (
      <YearGrid
        year={view.getFullYear()}
        minYear={minYear}
        maxYear={maxYear}
        current={view.getFullYear()}
        onPick={(y) => { setView(new Date(y, view.getMonth(), 1)); setMode('months'); }}
      />
    );
  }

  return (
    <div className="ac-dp-panel">
      <div className="ac-dp-head">
        <button type="button" className="ac-pick ac-dp-nav" aria-label="Mois précédent" disabled={view.getFullYear() <= minYear && view.getMonth() === 0} onClick={() => setView(addMonths(view, -1))}><ChevronLeft size={17} aria-hidden /></button>
        <button type="button" className="ac-pick ac-dp-title" onClick={() => setMode('months')} aria-label="Choisir le mois et l’année">
          {lang === 'fr' ? `${MONTHS[view.getMonth()]} ${view.getFullYear()}` : new Intl.DateTimeFormat(intlLocale(lang), { month: 'long', year: 'numeric' }).format(view)}<ChevronDown size={15} aria-hidden />
        </button>
        <button type="button" className="ac-pick ac-dp-nav" aria-label="Mois suivant" disabled={view.getFullYear() >= maxYear && view.getMonth() === 11} onClick={() => setView(addMonths(view, 1))}><ChevronRight size={17} aria-hidden /></button>
      </div>
      <div className="ac-dp-weekdays" aria-hidden>
        {WEEKDAYS.map((w, i) => <span key={w}>{lang === 'fr' ? w : new Intl.DateTimeFormat(intlLocale(lang), { weekday: 'short' }).format(new Date(2024, 0, i + 1))}</span>)}
      </div>
      <div className="ac-dp-grid" ref={gridRef} role="grid" onKeyDown={onKey} onMouseLeave={() => setHover?.(null)}>
        {cells.map((d) => {
          const iso = toISO(d);
          const outside = !sameMonth(d, view);
          const disabled = isDisabled(d);
          const isStart = sameDay(d, lo);
          const isEnd = sameDay(d, hi);
          const inRange = !!lo && !!hi && d > lo && d < hi;
          const isSel = sameDay(d, selected) || isStart || isEnd;
          const cellCls = ['ac-dp-cell', inRange ? 'in-range' : '', isStart && hi && !sameDay(lo, hi) ? 'range-start' : '', isEnd && lo && !sameDay(lo, hi) ? 'range-end' : ''].filter(Boolean).join(' ');
          return (
            <div key={iso} className={cellCls} role="gridcell" aria-selected={isSel}>
              <button
                type="button"
                data-day={iso}
                tabIndex={sameDay(d, focus) ? 0 : -1}
                className={['ac-pick ac-dp-day', outside ? 'is-outside' : '', isSel ? 'is-selected' : '', sameDay(d, today) ? 'is-today' : ''].filter(Boolean).join(' ')}
                disabled={disabled}
                aria-label={lang === 'fr' ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' }).format(d)}
                aria-current={sameDay(d, today) ? 'date' : undefined}
                onMouseEnter={() => setHover?.(d)}
                onFocus={() => setFocus(d)}
                onClick={() => onPick(d)}
              >
                {d.getDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── DatePicker ───────────────────────────────────────────────────────────────

type DatePickerProps = {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  min?: string;
  max?: string;
  /** First year offered (default 1910 — birthdays, founding dates…) */
  minYear?: number;
  /** Last year offered (default current year + 10) */
  maxYear?: number;
  size?: 'md' | 'sm';
};

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
  useLang(); // refresh formatted values when the interface language changes
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback((v: boolean) => setOpenState(v), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const selected = parseISO(value);
  const [view, setView] = useState<Date>(() => startOfMonth(selected || new Date()));
  const { style, sheet } = usePickerPopover(open, setOpen, triggerRef, popRef);
  const minD = parseISO(min || '');
  const maxD = parseISO(max || '');
  const yMax = maxYear ?? new Date().getFullYear() + 10;

  useEffect(() => {
    if (open) setView(startOfMonth(parseISO(value) || new Date()));
  }, [open, value]);

  const isDisabled = (d: Date) => (!!minD && d < minD) || (!!maxD && d > maxD);
  const pick = (d: Date) => {
    if (isDisabled(d)) return;
    onChange(toISO(d));
    emitEdit(triggerRef.current);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={`ac-dp ${className}`.trim()}>
      <Trigger
        triggerRef={triggerRef}
        id={id}
        open={open}
        disabled={disabled}
        size={size}
        className=""
        placeholder={placeholder}
        text={value ? formatDisplay(value) : ''}
        onToggle={() => !disabled && setOpen(!open)}
      />
      <PickerPortal open={open} popRef={popRef} style={style} sheet={sheet} label="Calendrier" onClose={() => setOpen(false)}>
        <Calendar view={view} setView={setView} selected={selected} isDisabled={isDisabled} onPick={pick} minYear={minYear} maxYear={yMax} />
        <div className="ac-dp-foot">
          <button type="button" className="ac-pick ac-dp-btn" disabled={isDisabled(todayDate())} onClick={() => pick(todayDate())}>Aujourd’hui</button>
          {value ? <button type="button" className="ac-pick ac-dp-btn is-ghost" onClick={() => { onChange(''); emitEdit(triggerRef.current); setOpen(false); }}>Effacer</button> : null}
        </div>
      </PickerPortal>
    </div>
  );
}

// ── DateRangePicker ─────────────────────────────────────────────────────────

type DateRangePickerProps = {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  disabled?: boolean;
  className?: string;
  size?: 'md' | 'sm';
  /** Preset ranges beside the calendar (dashboard style). */
  showPresets?: boolean;
};

type PresetKey = 'today' | 'yesterday' | '7' | '30' | 'month' | 'lastMonth';
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Aujourd’hui' },
  { key: 'yesterday', label: 'Hier' },
  { key: '7', label: '7 derniers jours' },
  { key: '30', label: '30 derniers jours' },
  { key: 'month', label: 'Ce mois' },
  { key: 'lastMonth', label: 'Mois dernier' },
];

function presetRange(key: PresetKey): [Date, Date] {
  const t = todayDate();
  switch (key) {
    case 'today': return [t, t];
    case 'yesterday': return [addDays(t, -1), addDays(t, -1)];
    case '7': return [addDays(t, -6), t];
    case '30': return [addDays(t, -29), t];
    case 'month': return [startOfMonth(t), t];
    case 'lastMonth': return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)];
    default: return [t, t];
  }
}

export function DateRangePicker({ from, to, onChange, disabled, className = '', size = 'md', showPresets = true }: DateRangePickerProps) {
  useLang(); // refresh formatted values when the interface language changes
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback((v: boolean) => setOpenState(v), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Date>(() => startOfMonth(parseISO(from) || new Date()));
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);
  const { style, sheet } = usePickerPopover(open, setOpen, triggerRef, popRef);
  const start = parseISO(from);
  const end = parseISO(to);

  useEffect(() => {
    if (!open) return;
    setDraftStart(null);
    setHover(null);
    setView(startOfMonth(parseISO(from) || new Date()));
  }, [open, from]);

  const activePreset = PRESETS.find((p) => {
    const [a, b] = presetRange(p.key);
    return sameDay(a, start) && sameDay(b, end);
  })?.key;

  const apply = (a: Date, b: Date) => {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    onChange(toISO(lo), toISO(hi));
    emitEdit(triggerRef.current);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onPick = (d: Date) => {
    if (!draftStart) {
      setDraftStart(d);
      return;
    }
    apply(draftStart, d);
  };

  return (
    <div className={`ac-dp ac-dp-range-wrap ${className}`.trim()}>
      <Trigger
        triggerRef={triggerRef}
        open={open}
        disabled={disabled}
        size={size}
        className=""
        placeholder="Choisir une période"
        text={formatRange(from, to)}
        onToggle={() => !disabled && setOpen(!open)}
      />
      <PickerPortal open={open} popRef={popRef} style={style} sheet={sheet} label="Période" className={`is-range${showPresets ? ' has-presets' : ''}`} onClose={() => setOpen(false)}>
        {showPresets ? (
          <div className="ac-dp-presets" role="group" aria-label="Raccourcis">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" className={`ac-pick ac-dp-preset${activePreset === p.key ? ' is-active' : ''}`} aria-pressed={activePreset === p.key} onClick={() => { const [a, b] = presetRange(p.key); apply(a, b); }}>
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ac-dp-range-main">
          <p className="ac-dp-hint" aria-live="polite">
            <span className={draftStart ? '' : 'is-on'}>Début</span>
            <ChevronRight size={13} aria-hidden />
            <span className={draftStart ? 'is-on' : ''}>Fin</span>
            <b>{draftStart ? `${formatDisplay(toISO(draftStart))} → choisissez la fin` : 'Choisissez la date de début'}</b>
          </p>
          <Calendar
            view={view}
            setView={setView}
            rangeStart={draftStart || start}
            rangeEnd={draftStart ? null : end}
            hover={draftStart ? hover : null}
            setHover={setHover}
            isDisabled={() => false}
            onPick={onPick}
            minYear={1910}
            maxYear={new Date().getFullYear() + 10}
          />
          <div className="ac-dp-foot">
            <button type="button" className="ac-pick ac-dp-btn is-ghost" onClick={() => setOpen(false)}>Annuler</button>
            <button type="button" className="ac-pick ac-dp-btn" onClick={() => apply(todayDate(), todayDate())}>Aujourd’hui</button>
          </div>
        </div>
      </PickerPortal>
    </div>
  );
}

// ── MonthPicker ──────────────────────────────────────────────────────────────

type MonthPickerProps = {
  /** 'YYYY-MM' */
  value: string;
  onChange: (ym: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  /** 'YYYY-MM' bounds (inclusive) */
  min?: string;
  max?: string;
  size?: 'md' | 'sm';
  'aria-label'?: string;
};

const parseYM = (v: string | undefined | null) => {
  if (!v || !/^\d{4}-\d{2}$/.test(v)) return null;
  const [y, m] = v.split('-').map(Number);
  return m >= 1 && m <= 12 ? { y, m: m - 1 } : null;
};

export function MonthPicker({ value, onChange, disabled, placeholder = 'Choisir un mois', className = '', id, min, max, size = 'md', 'aria-label': ariaLabel }: MonthPickerProps) {
  useLang(); // refresh formatted values when the interface language changes
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback((v: boolean) => setOpenState(v), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const current = parseYM(value);
  const [year, setYear] = useState(() => current?.y ?? new Date().getFullYear());
  const [mode, setMode] = useState<'months' | 'years'>('months');
  const { style, sheet } = usePickerPopover(open, setOpen, triggerRef, popRef);
  const lo = parseYM(min);
  const hi = parseYM(max);
  const minYear = lo?.y ?? 2000;
  const maxYear = hi?.y ?? new Date().getFullYear() + 5;

  useEffect(() => {
    if (!open) return;
    setYear(parseYM(value)?.y ?? new Date().getFullYear());
    setMode('months');
  }, [open, value]);

  const isDisabled = (y: number, m: number) => (!!lo && (y < lo.y || (y === lo.y && m < lo.m))) || (!!hi && (y > hi.y || (y === hi.y && m > hi.m)));
  const label = current ? (getLang() === 'fr' ? `${MONTHS[current.m]} ${current.y}` : new Intl.DateTimeFormat(intlLocale(), { month: 'long', year: 'numeric' }).format(new Date(current.y, current.m, 1))) : '';
  const now = new Date();

  return (
    <div className={`ac-dp ac-dp-month-wrap ${className}`.trim()}>
      <Trigger
        triggerRef={triggerRef}
        id={id}
        open={open}
        disabled={disabled}
        size={size}
        className=""
        placeholder={placeholder}
        text={label}
        onToggle={() => !disabled && setOpen(!open)}
      />
      {ariaLabel ? <span className="sr-only">{ariaLabel}</span> : null}
      <PickerPortal open={open} popRef={popRef} style={style} sheet={sheet} label={ariaLabel || 'Choisir un mois'} className="is-month" onClose={() => setOpen(false)}>
        {mode === 'months' ? (
          <MonthGrid
            year={year}
            setYear={setYear}
            current={current}
            minYear={minYear}
            maxYear={maxYear}
            isDisabled={isDisabled}
            onYearTitle={() => setMode('years')}
            onPick={(m) => { onChange(`${year}-${pad2(m + 1)}`); emitEdit(triggerRef.current); setOpen(false); triggerRef.current?.focus(); }}
          />
        ) : (
          <YearGrid year={year} minYear={minYear} maxYear={maxYear} current={year} onPick={(y) => { setYear(y); setMode('months'); }} />
        )}
        <div className="ac-dp-foot">
          <button
            type="button"
            className="ac-pick ac-dp-btn"
            disabled={isDisabled(now.getFullYear(), now.getMonth())}
            onClick={() => { onChange(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`); emitEdit(triggerRef.current); setOpen(false); }}
          >
            Ce mois-ci
          </button>
        </div>
      </PickerPortal>
    </div>
  );
}
