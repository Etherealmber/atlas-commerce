import { downloadExport } from '../lib/export';
import { useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import { validateClientForm, firstError } from '../lib/formValidate';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import PasswordConfirm from '../components/PasswordConfirm';
import SaveFeedback from '../components/SaveFeedback';
import { numStr, numFromInput } from '../lib/numInput';
import { openReport } from '../lib/reports';
import NumberField from '../components/NumberField';
import RefreshIconButton from '../components/RefreshIconButton';
import '../components/erp/crm-parties.css';

export default function Clients() {
  const navigate = useNavigate();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [show, setShow] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [form, setForm] = useState({ name: '', ice: '', if_number: '', address: '', city: '', phone: '', email: '', tax_exempt: false as boolean, credit_limit: 0 as number });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    api.getClients().then((r) => setList(r.data)).finally(() => {
      setLoading(false);
      setRefreshing(false);
    });
  };
  useEffect(() => { load(); }, []);

  const filtered = list.filter((c) =>
    !search ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.ice?.toLowerCase().includes(search.toLowerCase()) ||
    c.city?.toLowerCase().includes(search.toLowerCase())
  );

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((c) => next.delete(c.id));
      } else {
        filtered.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };

  const save = async () => {
    const fe = validateClientForm(form);
    setFieldErrors(fe);
    if (Object.keys(fe).length) { flash(firstError(fe) || 'Formulaire incomplet.', 'error'); return; }
    setSaving(true);
    try {
      await api.createClient(form);
      setShow(false);
      setForm({ name: '', ice: '', if_number: '', address: '', city: '', phone: '', email: '', tax_exempt: false, credit_limit: 0 });
      flash('Client enregistré dans la base de données avec succès.');
      load(true);
    } catch (e: any) {
      flash(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (ids?: number[]) => {
    const targetIds = ids && ids.length ? ids : Array.from(selected);
    if (!targetIds.length) { flash('Sélectionnez au moins un client.', 'error'); return; }
    setSelected(new Set(targetIds));
    setPwTitle(targetIds.length === 1 ? 'Supprimer le client' : `Supprimer ${targetIds.length} clients`);
    setPwDesc('Cette action est définitive. Saisissez votre mot de passe pour confirmer.');
    setPendingAction(() => async (password: string) => {
      const res = targetIds.length === 1
        ? await api.deleteClient(targetIds[0], password)
        : await api.bulkDeleteClients(targetIds, password);
      flash((res as any).message || 'Client(s) supprimé(s).');
      setPwOpen(false); setPendingAction(null);
      setSelected(new Set());
      load(true);
    });
    setPwOpen(true);
  };

  if (loading) return <div className="empty">Chargement des clients...</div>;

  return (
    <div className="atlas-crm">
      <div className="page-header">
        <h1>Clients</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          {selected.size > 0 && (
            <button className="danger" onClick={() => openDelete()}>
              Supprimer la sélection ({selected.size})
            </button>
          )}
          <button onClick={() => setShow(true)}>+ Nouveau client</button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="search-bar"><input className="search-input" placeholder="Rechercher par nom, ICE ou ville..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>

      {(() => {
        const totalDue = list.reduce((s, c) => s + Number((c as any).balance_due || 0), 0);
        const withDue = list.filter((c) => Number((c as any).balance_due || 0) > 0.001).length;
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const newMonth = list.filter((c) => String((c as any).created_at || '').startsWith(ym)).length;
        return (
          <div className="atlas-stat-grid" style={{ marginBottom: 16 }}>
            <div className="atlas-stat paper">
              <div className="as-label">Solde total dû</div>
              <div className="as-value" style={{ fontSize: '1.35rem' }}>{Math.round(totalDue).toLocaleString('fr-FR')} MAD</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>sur {withDue} compte{withDue !== 1 ? 's' : ''}</div>
              {withDue > 0 && <span className="badge" style={{ marginTop: 6, background: '#fef3c7', color: '#92400e' }}>à relancer</span>}
            </div>
            <div className="atlas-stat paper">
              <div className="as-label">Nouveaux ce mois</div>
              <div className="as-value" style={{ fontSize: '1.35rem' }}>{newMonth}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>clients ajoutés</div>
            </div>
            <div className="atlas-stat paper">
              <div className="as-label">Comptes actifs</div>
              <div className="as-value" style={{ fontSize: '1.35rem' }}>{list.length}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>dans le fichier</div>
            </div>
          </div>
        );
      })()}

      <div className="card">
        <div className="table-wrap">
          <table className="data-dense">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <th>Nom</th>
                <th>ICE</th>
                <th>Ville</th>
                <th>Solde</th>
                <th>Statut</th>
                <th>Téléphone</th>
                <th>E-mail</th>
                <th>TVA</th>
                <th>Crédit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      aria-label={`Sélectionner ${c.name}`}
                    />
                  </td>
                  <td>
                    <div className="party-name">{c.name}</div>
                    {(c.ice || c.city) && <div className="party-sub">{[c.ice, c.city].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td>{c.ice || '—'}</td>
                  <td>{c.city || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{Math.round(Number((c as any).balance_due || 0)).toLocaleString('fr-FR')} MAD</td>
                  <td>{Number((c as any).balance_due || 0) > 0.001
                    ? <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Solde dû</span>
                    : <span className="badge" style={{ background: '#e8f5e9', color: '#2d5a2d' }}>Soldé</span>}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.tax_exempt ? <span className="badge" style={{ background: '#e8f5e9', color: '#2d5a2d' }}>Exonéré</span> : 'Assujetti'}</td>
                  <td>
                    <span className="mono-amt">{Number(c.credit_limit) > 0 ? Number(c.credit_limit).toLocaleString('fr-FR') : '∞'}</span>
                    {Number(c.credit_limit) > 0 && Number((c as any).balance_due || 0) > Number(c.credit_limit) && (
                      <span className="credit-pill danger" style={{ marginLeft: 6 }}>Dépassement</span>
                    )}
                    {Number(c.credit_limit) > 0 && Number((c as any).balance_due || 0) > 0 && Number((c as any).balance_due || 0) <= Number(c.credit_limit) && (
                      <span className="credit-pill warn" style={{ marginLeft: 6 }}>Encours</span>
                    )}
                    {Number(c.credit_limit) <= 0 && <span className="credit-pill muted" style={{ marginLeft: 6 }}>Illimité</span>}
                  </td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Link to={`/invoices?client=${c.id}`} style={{ fontSize: 12 }} className="btn secondary">Factures</Link>
                    {c.email ? (
                      <button
                        type="button"
                        className="secondary"
                        style={{ fontSize: 12, marginLeft: 6 }}
                        onClick={() => navigate(`/mailbox/compose?to=${encodeURIComponent(c.email)}&client=${encodeURIComponent(c.name || '')}`)}
                      >
                        E-mail
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() =>
                        openReport('/api/reports/client-situation', {
                          client_id: String(c.id),
                          name: c.name || '',
                          ice: c.ice || '',
                        })
                      }
                    >
                      Situation (synthèse)
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      title="Même rapport avec le détail des produits par pièce"
                      onClick={() =>
                        openReport('/api/reports/client-situation', {
                          client_id: String(c.id),
                          name: c.name || '',
                          ice: c.ice || '',
                          detail: 'full',
                        })
                      }
                    >
                      Situation (détail produits)
                    </button>
                    <button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openDelete([c.id])}>Suppr.</button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr className="atlas-empty-row">
                  <td colSpan={11}>
                    <EmptyState
                      title="Aucun client"
                      description="Ajoutez vos acheteurs (ICE, contact, limite de crédit) pour facturer plus vite."
                      actionLabel="Nouveau client"
                      onAction={() => setShow(true)}
                      icon="user"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {show && (
        <div className="modal-overlay" onClick={() => setShow(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau client</h2>
            <div className="form-row"><label>Nom *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={!form.name.trim() ? 'input-warn' : ''} />
              {!form.name.trim() && <span className="field-hint">Obligatoire</span>}</div>
            <div className="grid grid-2">
              <div className="form-row"><label>ICE</label>
                <input value={form.ice} onChange={(e) => setForm({ ...form, ice: e.target.value })} /></div>
              <div className="form-row"><label>IF</label>
                <input value={form.if_number} onChange={(e) => setForm({ ...form, if_number: e.target.value })} /></div>
            </div>
            <div className="form-row"><label>Adresse</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid grid-2">
              <div className="form-row"><label>Ville</label>
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              <div className="form-row"><label>Téléphone</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="form-row"><label>E-mail</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="form-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!form.tax_exempt}
                  onChange={(e) => setForm({ ...form, tax_exempt: e.target.checked })}
                />
                Exonéré de TVA (tax exempt) — les factures/devis de ce client auront TVA à 0 %
              </label>
            </div>
            <div className="form-row">
              <label>Limite de crédit (0 = illimité)</label>
              <NumberField
                value={form.credit_limit}
                onValueChange={(n) => setForm({ ...form, credit_limit: n })}
                min={0}
                step="0.01"
                placeholder="Ex. 50000"
              />
              <small style={{ color: 'var(--muted)', fontSize: 12 }}>
                Plafond d&apos;encours (factures non soldées). Blocage à la création de facture et à la conversion devis→facture.
              </small>
            </div>
            <div className="form-actions">
              <button onClick={save} disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer dans la base'}</button>
              <button className="secondary" onClick={() => setShow(false)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {pwOpen && pendingAction && (
        <PasswordConfirm
          open={pwOpen}
          title={pwTitle}
          description={pwDesc}
          confirmLabel="Confirmer"
          onCancel={() => { setPwOpen(false); setPendingAction(null); }}
          onConfirm={async (password) => { await pendingAction(password); }}
        />
      )}
    </div>
  );
}
