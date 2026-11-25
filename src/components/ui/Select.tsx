/**
 * <Select> — drop-in replacement for the native <select>: same props, same
 * <option>/<optgroup> children, same onChange(e) with e.target.value.
 *
 * Why: the OS dropdown looks different everywhere, ignores the app's light /
 * dark / RTL look, and fixed-width filters cut labels (« Toutes catégo »).
 *
 * How it works (deliberately "enhanced native", not a re-implementation):
 *  - The real <select> stays the visible box. Every existing class, context
 *    rule (.form-group select, dark theme, focus ring…), label htmlFor, form
 *    name/required and test keeps working unchanged.
 *  - Its min-width is measured from the WIDEST option label, so the current
 *    value is never truncated.
 *  - Pointer / tap / Space / Enter / Alt+↓ open OUR listbox instead of the OS
 *    one (portal, flips above when there's no room, type-to-filter past 8
 *    options, ↑ ↓ Home End Enter Esc). Picking an option sets the native value
 *    and dispatches a real `change`, so React's onChange fires as before.
 *  - `multiple` / `size > 1` selects are left fully native.
 */
import {
  Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ReactElement, type ReactNode, type Ref, type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Search } from 'lucide-react';

type Opt = { value: string; label: string; disabled: boolean; group?: string };

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

export function collectOptions(children: ReactNode, out: Opt[] = [], group?: string): Opt[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ children?: ReactNode; label?: unknown; value?: unknown; disabled?: boolean }>;
    if (el.type === Fragment) { collectOptions(el.props.children, out, group); return; }
    if (el.type === 'optgroup') { collectOptions(el.props.children, out, String(el.props.label ?? '')); return; }
    if (el.type === 'option') {
      const label = textOf(el.props.children) || String(el.props.label ?? '');
      const value = el.props.value !== undefined ? String(el.props.value) : label;
      out.push({ value, label, disabled: Boolean(el.props.disabled), group });
    }
  });
  return out;
}

/** Sets a native select's value, then fires `change` so React's onChange runs. */
function commitNative(sel: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(sel, value);
  else sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

let measureCanvas: HTMLCanvasElement | null = null;
function textWidth(text: string, font: string): number {
  try {
    measureCanvas ??= document.createElement('canvas');
    const ctx2d = measureCanvas.getContext('2d');
    if (!ctx2d) return 0;
    ctx2d.font = font;
    return ctx2d.measureText(text).width;
  } catch {
    return 0;
  }
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> };

const MAX_AUTO_MIN_WIDTH = 300;

export default function Select(props: SelectProps) {
  const { children, ref: outerRef, className, ...rest } = props;
  const enhanced = !rest.multiple && !(typeof rest.size === 'number' && rest.size > 1);
  const selRef = useRef<HTMLSelectElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const listId = useId();
  const options = useMemo(() => collectOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [current, setCurrent] = useState('');
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number; up: boolean } | null>(null);

  const setRefs = useCallback((el: HTMLSelectElement | null) => {
    selRef.current = el;
    if (typeof outerRef === 'function') outerRef(el);
    else if (outerRef && typeof outerRef === 'object') (outerRef as { current: HTMLSelectElement | null }).current = el;
  }, [outerRef]);

  // Never cut the selected label: min-width = widest option + paddings + arrow.
  useLayoutEffect(() => {
    const sel = selRef.current;
    if (!sel || !enhanced || !options.length) return;
    const cs = getComputedStyle(sel as unknown as Element);
    const font = cs.font || `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let widest = 0;
    for (const o of options) widest = Math.max(widest, textWidth(o.label, font));
    if (!widest) return;
    const pad = (parseFloat(cs.paddingLeft) || 0) + Math.max(parseFloat(cs.paddingRight) || 0, 28)
      + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0) + 6;
    sel.style.minWidth = `${Math.min(MAX_AUTO_MIN_WIDTH, Math.ceil(widest + pad))}px`;
  }, [options, enhanced]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const place = useCallback(() => {
    const sel = selRef.current;
    if (!sel) return;
    const r = sel.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const below = vh - r.bottom - 10;
    const above = r.top - 10;
    const want = Math.min(340, 52 + options.length * 38);
    const up = below < Math.min(want, 220) && above > below;
    const width = Math.min(vw - 16, Math.max(r.width, 180));
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const maxH = Math.max(150, Math.min(340, up ? above : below));
    setPos(up ? { left, width, bottom: vh - r.top + 6, maxH, up } : { left, width, top: r.bottom + 6, maxH, up });
  }, [options.length]);

  const openList = useCallback(() => {
    const sel = selRef.current;
    if (!sel || sel.disabled || !enhanced) return;
    const v = sel.value;
    setCurrent(v);
    place();
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === v)));
    setOpen(true);
  }, [enhanced, options, place]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) selRef.current?.focus({ preventScroll: true });
  }, []);

  const pick = (o: Opt) => {
    if (o.disabled) return;
    close();
    const sel = selRef.current;
    if (!sel || sel.value === o.value) return;
    commitNative(sel, o.value);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && (listRef.current?.contains(t) || selRef.current?.contains(t))) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && listRef.current?.contains(t)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const move = (delta: number) => {
    if (!filtered.length) return;
    let i = active;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + delta + filtered.length) % filtered.length;
      if (!filtered[i].disabled) break;
    }
    setActive(i);
  };

  const onListKey = <T,>(e: React.KeyboardEvent<T>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(filtered.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[active]; if (o) pick(o); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { close(); }
  };

  if (!enhanced) {
    return <select {...rest} ref={setRefs} className={className}>{children}</select>;
  }

  const showSearch = options.length > 8;
  const dir = typeof document !== 'undefined' ? document.documentElement.getAttribute('dir') || undefined : undefined;
  let lastGroup: string | undefined;

  return (
    <>
      <select
        {...rest}
        ref={setRefs}
        className={[className, 'ac-sel', open ? 'is-open' : ''].filter(Boolean).join(' ')}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        onMouseDown={(e) => {
          rest.onMouseDown?.(e);
          if (e.defaultPrevented || e.button !== 0) return;
          e.preventDefault(); // suppress the OS dropdown
          selRef.current?.focus({ preventScroll: true });
          if (open) close(); else openList();
        }}
        onTouchStart={(e) => {
          rest.onTouchStart?.(e);
          const t = e.touches[0];
          touchRef.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          rest.onTouchEnd?.(e);
          const start = touchRef.current;
          touchRef.current = null;
          const t = e.changedTouches[0];
          if (!start || !t || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) return; // it was a scroll
          e.preventDefault(); // suppress the OS picker (iOS / Android)
          if (open) close(false); else openList();
        }}
        onKeyDown={(e) => {
          rest.onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (open) { onListKey(e); return; }
          if (e.key === ' ' || e.key === 'Enter' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
            e.preventDefault();
            openList();
          }
        }}
      >
        {children}
      </select>
      {open && pos && createPortal(
        <div
          ref={listRef}
          className={`ac-select-pop${pos.up ? ' is-up' : ''}`}
          style={{ left: pos.left, width: pos.width, maxHeight: pos.maxH, top: pos.top, bottom: pos.bottom }}
          onKeyDown={onListKey}
          dir={dir}
        >
          {showSearch && (
            <label className="ac-select-search">
              <Search size={14} strokeWidth={2} aria-hidden="true" />
              <input
                autoFocus
                value={query}
                placeholder="Rechercher…"
                aria-label="Filtrer la liste"
                aria-controls={listId}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              />
            </label>
          )}
          <div
            id={listId}
            role="listbox"
            className="ac-select-list"
            aria-label={rest['aria-label'] || undefined}
            aria-activedescendant={active >= 0 && filtered[active] ? `${listId}-o${active}` : undefined}
          >
            {filtered.length === 0 && <div className="ac-select-empty">Aucun résultat</div>}
            {filtered.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const isSel = o.value === current;
              return (
                <Fragment key={`${o.group || ''}|${o.value}|${i}`}>
                  {head ? <div className="ac-select-group" role="presentation">{head}</div> : null}
                  <div
                    id={`${listId}-o${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={isSel}
                    aria-disabled={o.disabled || undefined}
                    className={`ac-select-opt${isSel ? ' is-selected' : ''}${i === active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
                    onPointerMove={() => { if (active !== i) setActive(i); }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                  >
                    <span className="ac-select-opt-label">{o.label}</span>
                    {isSel ? <Check size={15} strokeWidth={2.4} aria-hidden="true" /> : null}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
