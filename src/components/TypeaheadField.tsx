import { useEffect, useMemo, useRef, useState } from 'react';

export type TypeaheadOption = {
  id: string | number;
  label: string;
  sub?: string;
  /** Extra line e.g. stock */
  meta?: string;
  searchText?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onPick: (opt: TypeaheadOption) => void;
  options: TypeaheadOption[];
  placeholder?: string;
  emptyLabel?: string;
  max?: number;
  disabled?: boolean;
  /** Refresh options when the field is focused (e.g. reload stock) */
  onOpen?: () => void;
};

/**
 * Typeahead: shows what the user types; does NOT auto-select.
 * Pick only on click or Enter (highlighted row).
 */
export default function TypeaheadField({
  value,
  onChange,
  onPick,
  options,
  placeholder = 'Rechercher…',
  emptyLabel = 'Aucun résultat',
  max = 12,
  disabled,
  onOpen,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = value.toLowerCase().trim();
    const list = !q
      ? options
      : options.filter((o) => {
          const hay = (o.searchText || `${o.label} ${o.sub || ''} ${o.meta || ''}`).toLowerCase();
          return hay.includes(q);
        });
    return list.slice(0, max);
  }, [options, value, max]);

  useEffect(() => {
    setHi(0);
  }, [value, open]);

  const pick = (o: TypeaheadOption) => {
    if (o.disabled) return;
    onPick(o);
    setOpen(false);
  };

  return (
    <div className="atlas-typeahead" ref={rootRef} style={{ position: 'relative' }}>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        onFocus={() => {
          setOpen(true);
          onOpen?.();
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            setOpen(true);
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = filtered[hi];
            if (o) pick(o);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && (
        <div className="atlas-typeahead-menu" role="listbox">
          {filtered.map((o, i) => (
            <button
              key={String(o.id)}
              type="button"
              role="option"
              aria-selected={i === hi}
              className={`secondary atlas-typeahead-item${i === hi ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(o)}
            >
              <span className="atlas-typeahead-main">
                <strong>{o.label}</strong>
                {o.sub ? <span className="atlas-typeahead-sub">{o.sub}</span> : null}
              </span>
              {o.meta ? <span className="atlas-typeahead-meta">{o.meta}</span> : null}
            </button>
          ))}
          {!filtered.length && <div className="atlas-typeahead-empty">{emptyLabel}</div>}
          <div className="atlas-typeahead-hint">Entrée pour choisir · Échap pour fermer</div>
        </div>
      )}
    </div>
  );
}

/** Build product options with live stock label */
export function productTypeaheadOptions(products: any[]): TypeaheadOption[] {
  return (products || []).map((p) => {
    const stock = Number(p.stock_quantity ?? p.stock ?? p.qty ?? 0);
    const price = Number(p.price ?? p.unit_price ?? p.cost ?? 0);
    const sku = p.sku ? String(p.sku) : '';
    return {
      id: p.id,
      label: p.name || `#${p.id}`,
      sub: [sku, price ? `${price.toLocaleString('fr-FR')} MAD` : ''].filter(Boolean).join(' · '),
      meta: `Stock ${stock.toLocaleString('fr-FR')}`,
      searchText: `${p.name || ''} ${sku} ${p.barcode || ''}`,
      disabled: false,
    };
  });
}

export function partyTypeaheadOptions(rows: any[], kind: 'client' | 'vendor' = 'client'): TypeaheadOption[] {
  return (rows || []).map((c) => {
    const due = Number(c.balance_due ?? c.balance ?? 0);
    const limit = Number(c.credit_limit ?? 0);
    let meta = '';
    if (kind === 'client') {
      if (limit > 0) {
        meta = due > 0.001
          ? `Crédit ${Math.round(due).toLocaleString('fr-FR')} / ${Math.round(limit).toLocaleString('fr-FR')}`
          : `Crédit max ${Math.round(limit).toLocaleString('fr-FR')}`;
      } else if (due > 0.001) {
        meta = `Ouvert ${Math.round(due).toLocaleString('fr-FR')} MAD`;
      } else {
        meta = 'Crédit libre';
      }
    }
    return {
      id: c.id,
      label: c.name || `#${c.id}`,
      sub: [c.city, c.ice ? `ICE ${c.ice}` : ''].filter(Boolean).join(' · '),
      meta: meta || undefined,
      searchText: `${c.name || ''} ${c.ice || ''} ${c.city || ''} ${c.phone || ''}`,
    };
  });
}
