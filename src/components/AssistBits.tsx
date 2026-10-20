/** Small UI helpers for invoice/assist flows */
import type { ReactNode } from 'react';

export function SuggestList({
  items,
  onPick,
}: {
  items: { key: string; title: string; sub?: string }[];
  onPick: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul
      className="assist-suggest-list"
      style={{
        listStyle: 'none',
        margin: '4px 0 0',
        padding: 0,
        border: '1px solid var(--line, #e5e0d6)',
        borderRadius: 10,
        background: 'var(--paper, #fff)',
        maxHeight: 200,
        overflow: 'auto',
        zIndex: 20,
        position: 'absolute',
        left: 0,
        right: 0,
        boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
      }}
    >
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            onClick={() => onPick(it.key)}
            style={{
              width: '100%',
              textAlign: 'left',
              border: 'none',
              background: 'transparent',
              padding: '8px 10px',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>{it.title}</div>
            {it.sub ? (
              <div style={{ fontSize: 11, color: 'var(--muted, #9aa3b5)' }}>{it.sub}</div>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

const NOTE_CHIPS = [
  'Livraison urgente',
  'Client régulier',
  'Prix négocié',
  'Paiement à la livraison',
  'Retrait magasin',
];

export function NoteChips({
  value,
  onChange,
  chips = NOTE_CHIPS,
}: {
  value: string;
  onChange: (v: string) => void;
  chips?: string[];
}) {
  const add = (chip: string) => {
    const v = (value || '').trim();
    if (v.includes(chip)) return;
    onChange(v ? `${v} · ${chip}` : chip);
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {chips.map((c) => (
        <button
          key={c}
          type="button"
          className="secondary"
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999 }}
          onClick={() => add(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

export function AssistHint({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>{children}</p>
  );
}
