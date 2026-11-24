/**
 * /m/clients — mobile parity with Android ClientsScreen.
 * Reuses api.ts directly; matches Android field labels and workflow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { api } from '../api';
import { friendlyError } from '../lib/errors';
import PhoneDialog from './PhoneDialog';
import PhoneSkeleton from './PhoneSkeleton';

export const PHONE_CLIENTS_PAGE_SIZE = 20;

interface PhoneClientRecord {
  id: number;
  name: string;
  phone: string;
  email: string;
  ice: string;
  address: string;
  city: string;
  credit_limit: number;
  balance_due: number;
}

export function mapClientRow(raw: any): PhoneClientRecord {
  const balanceDue = Number(
    raw?.balance_due ?? raw?.unpaid_total ?? raw?.solde_du ?? raw?.balance ?? 0,
  );
  return {
    id: Number(raw?.id || 0),
    name: String(raw?.name || ''),
    phone: String(raw?.phone || ''),
    email: String(raw?.email || ''),
    ice: String(raw?.ice || ''),
    address: String(raw?.address || ''),
    city: String(raw?.city || ''),
    credit_limit: Number(raw?.credit_limit ?? 0),
    balance_due: Number.isFinite(balanceDue) ? balanceDue : 0,
  };
}

export function filterMobileClients(list: PhoneClientRecord[], query: string): PhoneClientRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) =>
    [c.name, c.phone, c.ice].some((v) => v.toLowerCase().includes(q)),
  );
}

const fmtMad = (n: number) => `${Math.round(Number(n || 0)).toLocaleString('fr-FR')} MAD`;

export default function PhoneClients({ onToast }: { onToast: (msg: string) => void }) {
  const [rawList, setRawList] = useState<PhoneClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<PhoneClientRecord | null>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    ice: '',
    address: '',
    credit_limit: '0',
  });

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await api.getClients();
      const rows = Array.isArray((res as any)?.data) ? (res as any).data : [];
      setRawList(rows.map(mapClientRow));
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [query]);

  const filtered = useMemo(() => filterMobileClients(rawList, query), [rawList, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PHONE_CLIENTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(
    safePage * PHONE_CLIENTS_PAGE_SIZE,
    (safePage + 1) * PHONE_CLIENTS_PAGE_SIZE,
  );

  const openCreate = () => {
    setSelected(null);
    setForm({ name: '', phone: '', email: '', ice: '', address: '', credit_limit: '0' });
    setEditing(true);
  };

  const openEdit = (c: PhoneClientRecord) => {
    setForm({
      name: c.name,
      phone: c.phone,
      email: c.email,
      ice: c.ice,
      address: c.address,
      credit_limit: String(c.credit_limit || 0),
    });
    setEditing(true);
  };

  const performSave = async () => {
    if (!form.name.trim()) {
      onToast('Le nom du client est obligatoire.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        ice: form.ice.trim(),
        address: form.address.trim(),
        credit_limit: Math.max(0, Number(form.credit_limit) || 0),
      };
      if (selected?.id) {
        await api.updateClient(selected.id, payload);
        onToast('Client mis à jour.');
      } else {
        await api.createClient(payload);
        onToast('Client créé.');
      }
      setConfirmSave(false);
      setEditing(false);
      setSelected(null);
      await load(true);
    } catch (e: any) {
      onToast(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="phone-panel">
      <div className="ph-native-section-head">
        <div>
          <h1 className="ph-title" style={{ fontSize: 22 }}>Clients</h1>
          <p className="ph-sub">Annuaire clients et situation de crédit.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="ph-native-icon"
            aria-label="Actualiser les clients"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <RefreshCw size={18} />
          </button>
          <button type="button" className="ph-chip on" onClick={openCreate}>
            <Plus size={15} /> Nouveau
          </button>
        </div>
      </div>

      <div className="ph-catalog-search" style={{ marginBottom: 10 }}>
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          aria-label="Rechercher un client"
          placeholder="Nom, téléphone ou ICE…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <PhoneSkeleton variant="rows" label="Chargement des clients" />
      ) : error ? (
        <div className="ph-sale-error" role="alert">
          {error}{' '}
          <button type="button" className="ph-native-text" onClick={() => void load(false)}>
            Réessayer
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="ph-empty">
          <Users size={26} />
          <h2>Aucun client</h2>
          <p>{query.trim() ? 'Aucun client trouvé pour cette recherche.' : 'Ajoutez votre premier client.'}</p>
        </div>
      ) : (
        <>
          <div className="ph-catalog-summary" aria-live="polite">
            <span>{filtered.length} client{filtered.length > 1 ? 's' : ''}</span>
          </div>
          <div className="ph-catalog-list">
            {visible.map((c) => (
              <button
                type="button"
                key={c.id}
                className="ph-catalog-card"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => {
                  setSelected(c);
                  setEditing(false);
                }}
              >
                <div className="ph-catalog-info">
                  <strong>{c.name}</strong>
                  <p>{c.phone || 'Sans téléphone'}{c.ice ? ` · ICE ${c.ice}` : ''}</p>
                  <small>
                    Limite de crédit : {fmtMad(c.credit_limit)} · Solde dû : {fmtMad(c.balance_due)}
                  </small>
                </div>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <button
                type="button"
                className="ph-chip"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Précédent
              </button>
              <span className="ph-muted" style={{ fontSize: 12 }}>
                Page {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="ph-chip"
                disabled={safePage + 1 >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                Suivant
              </button>
            </div>
          )}
        </>
      )}

      {selected && !editing && (
        <PhoneDialog titleId="ph-client-detail-title" onClose={() => setSelected(null)}>
          <h2 id="ph-client-detail-title">{selected.name}</h2>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 13 }}>
            <dt className="ph-muted">Nom</dt><dd style={{ margin: 0 }}>{selected.name}</dd>
            <dt className="ph-muted">Téléphone</dt><dd style={{ margin: 0 }}>{selected.phone || '—'}</dd>
            <dt className="ph-muted">Email</dt><dd style={{ margin: 0 }}>{selected.email || '—'}</dd>
            <dt className="ph-muted">ICE</dt><dd style={{ margin: 0 }}>{selected.ice || '—'}</dd>
            <dt className="ph-muted">Adresse</dt><dd style={{ margin: 0 }}>{selected.address || '—'}</dd>
            <dt className="ph-muted">Limite de crédit</dt><dd style={{ margin: 0 }}>{fmtMad(selected.credit_limit)}</dd>
            <dt className="ph-muted">Solde dû</dt><dd style={{ margin: 0 }}><strong>{fmtMad(selected.balance_due)}</strong></dd>
          </dl>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="ph-btn" onClick={() => openEdit(selected)}>Modifier</button>
            <button type="button" className="ph-chip" onClick={() => setSelected(null)}>Fermer</button>
          </div>
        </PhoneDialog>
      )}

      {editing && (
        <PhoneDialog titleId="ph-client-form-title" onClose={() => { if (!saving) setEditing(false); }}>
          <h2 id="ph-client-form-title">{selected ? 'Modifier le client' : 'Nouveau client'}</h2>
          <div className="ph-form-stack" style={{ display: 'grid', gap: 8 }}>
            <label>Nom *<input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></label>
            <label>Téléphone<input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></label>
            <label>Email<input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></label>
            <label>ICE<input value={form.ice} onChange={(e) => setForm((f) => ({ ...f, ice: e.target.value }))} /></label>
            <label>Adresse<input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></label>
            <label>Limite de crédit<input type="number" min="0" value={form.credit_limit} onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value }))} /></label>
          </div>
          {confirmSave ? (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 10, border: '1px solid var(--border, #e5e7eb)' }}>
              <p style={{ margin: '0 0 8px', fontSize: 13 }}>Confirmer l’enregistrement de ce client ?</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="ph-btn" disabled={saving} onClick={() => void performSave()}>
                  {saving ? 'Enregistrement…' : 'Confirmer'}
                </button>
                <button type="button" className="ph-chip" disabled={saving} onClick={() => setConfirmSave(false)}>Annuler</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="ph-btn" onClick={() => setConfirmSave(true)}>Enregistrer</button>
              <button type="button" className="ph-chip" onClick={() => setEditing(false)}>Annuler</button>
            </div>
          )}
        </PhoneDialog>
      )}
    </div>
  );
}
