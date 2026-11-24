/** Small UI helpers for invoice/assist flows */


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

