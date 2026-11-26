import { useState } from 'react';
import { Printer, Truck } from 'lucide-react';
import { api } from '../api';
import { openExistingDeliveryNote } from '../lib/deliveryNote';
import { friendlyError } from '../lib/errors';

type DeliveryNote = { id: number; number: string; client_name?: string; issue_date?: string };

/** Discover and reprint existing notes without creating a new document. */
export default function DeliveryNotesPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getDeliveryNotes();
      setNotes(Array.isArray(result.data) ? result.data : []);
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  };
  return <section className="delivery-notes-panel" aria-label="Bons de livraison">
    <button type="button" className="secondary delivery-notes-toggle" aria-expanded={open} aria-controls="delivery-notes-list" onClick={() => {
      if (!open) void load();
      setOpen(!open);
    }}><Truck size={16} aria-hidden="true" /> Bons de livraison</button>
    {open && <div className="card delivery-notes-list" id="delivery-notes-list">
      <div className="delivery-notes-heading"><div><h2>Bons de livraison</h2><p>Pour créer un bon, ouvrez une facture ou un ticket et choisissez « Bon de livraison ». Vous pouvez ensuite imprimer ou enregistrer en PDF.</p></div><button type="button" className="secondary" onClick={() => void load()} disabled={loading}>Actualiser</button></div>
      {loading && <p role="status">Chargement…</p>}
      {error && <p role="alert">{error} <button type="button" className="secondary" onClick={() => void load()}>Réessayer</button></p>}
      {!loading && !error && (notes.length === 0 ? <p>Aucun bon de livraison créé.</p> : <>
        <p className="delivery-notes-limit">Les 100 derniers bons sont affichés.</p>
        <div className="delivery-notes-rows">{notes.map(note => <div className="delivery-note-row" key={note.id}>
          <div><strong>{note.number}</strong><span>{note.client_name || '—'} · {note.issue_date || '—'}</span></div>
          <button type="button" className="secondary" onClick={() => { try { openExistingDeliveryNote(note.id); } catch (e) { setError(friendlyError(e)); } }}><Printer size={15} aria-hidden="true" /> Imprimer</button>
        </div>)}</div>
      </>)}
    </div>}
  </section>;
}
