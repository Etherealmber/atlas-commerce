import { useEffect, useRef, useState } from 'react';
import { Printer, Truck, X } from 'lucide-react';
import { api } from '../api';
import { openExistingDeliveryNote } from '../lib/deliveryNote';
import { friendlyError } from '../lib/errors';
import { FloatingPortal } from './FloatingPortal';

type DeliveryNote = { id: number; number: string; client_name?: string; issue_date?: string };

/** Discover and reprint existing notes without creating a new document. */
export default function DeliveryNotesPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const buttons = Array.from(dialog.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (!buttons.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); trigger.current?.focus(); };
  }, [open]);
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getDeliveryNotes();
      setNotes(Array.isArray(result.data) ? result.data : []);
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  };
  return <>
    <button ref={trigger} type="button" className="secondary delivery-notes-toggle" title="Bons de livraison" aria-label="Bons de livraison" aria-haspopup="dialog" onClick={() => { setOpen(true); void load(); }}><Truck size={16} aria-hidden="true" /><span className="tpa-label">Bons de livraison</span></button>
    {open && <FloatingPortal><div className="modal-overlay" onClick={() => setOpen(false)}>
      <div ref={dialog} tabIndex={-1} className="modal delivery-notes-list" role="dialog" aria-modal="true" aria-labelledby="delivery-notes-title" onClick={e => e.stopPropagation()}>
        <div className="delivery-notes-heading"><div><h2 id="delivery-notes-title">Bons de livraison</h2><p>Pour créer un bon, ouvrez une facture ou un ticket et choisissez « Bon de livraison ». Vous pouvez ensuite imprimer ou enregistrer en PDF.</p></div><button type="button" className="secondary" aria-label="Fermer" onClick={() => setOpen(false)}><X size={18} /></button></div>
        <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>Actualiser</button>
        {loading && <p role="status">Chargement…</p>}
        {error && <p role="alert">{error} <button type="button" className="secondary" onClick={() => void load()}>Réessayer</button></p>}
        {!loading && !error && (notes.length === 0 ? <p>Aucun bon de livraison créé.</p> : <>
          <p className="delivery-notes-limit">Les 100 derniers bons sont affichés.</p>
          <div className="delivery-notes-rows">{notes.map(note => <div className="delivery-note-row" key={note.id}>
            <div><strong>{note.number}</strong><span>{note.client_name || '—'} · {note.issue_date || '—'}</span></div>
            <button type="button" className="secondary" onClick={() => { try { openExistingDeliveryNote(note.id); } catch (e) { setError(friendlyError(e)); } }}><Printer size={15} aria-hidden="true" /> Imprimer</button>
          </div>)}</div>
        </>)}
      </div>
    </div></FloatingPortal>}
  </>;
}
