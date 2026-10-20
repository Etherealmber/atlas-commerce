import { TimedUndoDelete } from '../components/ui';
import { downloadExport } from '../lib/export';
import { onAgentDraft } from '../lib/agentDraft';
import { useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import { validateClientForm, firstError } from '../lib/formValidate';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import PasswordConfirm from '../components/PasswordConfirm';
import SaveFeedback from '../components/SaveFeedback';
import { numStr, numFromInput } from '../lib/numInput';
import { openReport } from '../lib/reports';
import NumberField from '../components/NumberField';
import RefreshIconButton from '../components/RefreshIconButton';
import '../components/erp/crm-parties.css';
import { FloatingPortal } from '../components/FloatingPortal';
import { ModalFormError, FieldHint } from '../components/ModalFormFeedback';

export default function Clients() {
  const navigate = useNavigate();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [show, setShow] = useState(false);
  const [sitChoice, setSitChoice] = useState<null | { id: number; name: string; ice: string }>(null);
  const [mailChoice, setMailChoice] = useState<null | { email: string; name: string }>(null);

  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [form, setForm] = useState({ name: '', ice: '', if_number: '', address: '', city: '', phone: '', email: '', tax_exempt: false as boolean, credit_limit: 0 as number });
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteArmId, setDeleteArmId] = useState<number | null>(null);
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
  
  useEffect(() => {
    const onLists = () => {
      try { load(true); } catch { /* */ }
    };
    window.addEventListener('atlas-lists-refresh', onLists as EventListener);
    return () => window.removeEventListener('atlas-lists-refresh', onLists as EventListener);
  }, []);

  
  useEffect(() => {
    const d = (window as any).__atlasClientDraft;
    if (!d || (!list.length && d.mode === 'edit')) return;
    if (!(d.open || d.mode === 'create' || d.mode === 'edit')) return;
    const pre = (d.prefill || {}) as any;
    if (d.mode === 'edit' && pre.name) {
      const found = list.find((c: any) => String(c.name || '').toLowerCase().includes(String(pre.name).toLowerCase()));
      if (found) {
        openEdit(found);
        (window as any).__atlasClientDraft = null;
        return;
      }
    }
    if (d.open || d.mode === 'create') {
      setEditId(null);
      setForm({
        name: pre.name || '',
        ice: pre.ice || '',
        if_number: '',
        address: pre.address || '',
        city: pre.city || '',
        phone: pre.phone || '',
        email: pre.email || '',
        tax_exempt: false,
        credit_limit: 0,
      });
      setFieldErrors({});
      setModalError('');
      setShow(true);
      (window as any).__atlasClientDraft = null;
    }
  }, [list]);

  
  useEffect(() => {
    return onAgentDraft((d) => {
      if (d.entity && d.entity !== 'client') return;
      
      const pre = (d.prefill || {}) as any;
      setEditId(null);
      setForm({
        name: pre.name || '',
        ice: pre.ice || '',
        if_number: '',
        address: pre.address || '',
        city: pre.city || '',
        phone: pre.phone || '',
        email: pre.email || '',
        tax_exempt: false,
        credit_limit: 0,
      });
      setFieldErrors({});
      setModalError('');
      setShow(true);

    });
  }, []);

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

  const openCreate = () => {
    setEditId(null);
    setForm({ name: '', ice: '', if_number: '', address: '', city: '', phone: '', email: '', tax_exempt: false, credit_limit: 0 });
    setFieldErrors({});
    setShow(true);
  };

  const openEdit = (c: any) => {
    setEditId(Number(c.id));
    setForm({
      name: c.name || '',
      ice: c.ice || '',
      if_number: c.if_number || '',
      address: c.address || '',
      city: c.city || '',
      phone: c.phone || '',
      email: c.email || '',
      tax_exempt: !!c.tax_exempt,
      credit_limit: Number(c.credit_limit) || 0,
    });
    setFieldErrors({});
    setShow(true);
  };

  const save = async () => {
    const fe = validateClientForm(form);
    setFieldErrors(fe);
    if (Object.keys(fe).length) {
      setModalError(firstError(fe) || 'Formulaire incomplet.');
      return;
    }
    setModalError('');
    setSaving(true);
    try {
      if (editId) {
        await api.updateClient(editId, form);
        flash('Client mis à jour.');
      } else {
        await api.createClient(form);
        flash('Client enregistré dans la base de données avec succès.');
      }
      setShow(false);
      setEditId(null);
      setForm({ name: '', ice: '', if_number: '', address: '', city: '', phone: '', email: '', tax_exempt: false, credit_limit: 0 });
      load(true);
    } catch (e: any) {
      setModalError(e?.message || 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (ids?: number[]) => {
    const targetIds = ids && ids.length ? ids : Array.from(selected);
    if (!targetIds.length) { flash('Sélectionnez au moins un client.', 'error'); return; }
    setSelected(new Set(targetIds));
    setPwTitle(targetIds.length === 1 ? 'Supprimer le client' : `Supprimer ${targetIds.length} clients`);
    setPwDesc('Cette action est définitive. Confirmez pour continuer.');
    setPendingAction(() => async (password: string) => {
      const res = targetIds.length === 1
        ? await api.deleteClient(targetIds[0], password || undefined as any)
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
    <div className="atlas-crm clients-page">
      <div className="page-header">
        <h1>Clients</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          {selected.size > 0 && (
            <TimedUndoDelete
              deleteLabel={`Supprimer (${selected.size})`}
              undoLabel="Annuler"
              initialSeconds={10}
              onConfirm={() => openDelete()}
            />
          )}
          <button type="button" onClick={openCreate}>Ajouter un client</button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="ac-panel ac-products-filters">
        <div className="ac-products-filters-row">
          <div className="ac-search-field">
            <svg className="ac-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input className="ac-search-input" placeholder="Nom, ICE ou ville…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher clients" />
          </div>
        </div>
      </div>

      {(() => {
        const totalDue = list.reduce((s, c) => s + Number((c as any).balance_due || 0), 0);
        const withDue = list.filter((c) => Number((c as any).balance_due || 0) > 0.001).length;
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const newMonth = list.filter((c) => String((c as any).created_at || '').startsWith(ym)).length;
        return (
          <div className="ac-metric-grid ac-metric-grid--3" style={{ marginBottom: 16 }}>
            <div className="ac-metric">
              <div className="as-label">Solde total dû</div>
              <div className="as-value" style={{ fontSize: '1.35rem' }}>{Math.round(totalDue).toLocaleString('fr-FR')} MAD</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>sur {withDue} compte{withDue !== 1 ? 's' : ''}</div>
              {withDue > 0 && <span className="badge" style={{ marginTop: 6, background: '#fef3c7', color: '#92400e' }}>à relancer</span>}
            </div>
            <div className="ac-metric">
              <div className="as-label">Nouveaux ce mois</div>
              <div className="as-value" style={{ fontSize: '1.35rem' }}>{newMonth}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>clients ajoutés</div>
            </div>
            <div className="ac-metric">
              <div className="as-label">Comptes actifs</div>
              <div className="as-value" style={{ fontSize: '1.35rem' }}>{list.length}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>dans le fichier</div>
            </div>
          </div>
        );
      })()}

      <div className="ac-panel ac-products-table-panel">
        <div className="table-wrap">
          <table className="data-dense ac-products-table">
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
                    <span
                        className="party-name party-name-link"
                        role="button"
                        tabIndex={0}
                        title="Modifier"
                        onClick={() => openEdit(c)}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEdit(c); } }}
                      >
                        {c.name}
                      </span>
                    {(c.ice || c.city) && <div className="party-sub">{[c.ice, c.city].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td>{c.ice || '—'}</td>
                  <td>{c.city || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{Math.round(Number((c as any).balance_due || 0)).toLocaleString('fr-FR')} MAD</td>
                  <td>{Number((c as any).balance_due || 0) > 0.001
                    ? <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Solde dû</span>
                    : <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>Soldé</span>}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.email ? (
                    <span
                      className="party-email-link"
                      role="button"
                      tabIndex={0}
                      title="Écrire un e-mail"
                      onClick={() => setMailChoice({ email: c.email, name: c.name || '' })}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setMailChoice({ email: c.email, name: c.name || '' });
                        }
                      }}
                    >
                      {c.email}
                    </span>
                  ) : '—'}</td>
                  <td>{c.tax_exempt ? <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>Exonéré</span> : 'Assujetti'}</td>
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
                  <td className="row-actions-cell"><div className="row-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => navigate(`/invoices?client=${c.id}&q=${encodeURIComponent(c.name || '')}`)}
                    >
                      Factures
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSitChoice({ id: c.id, name: c.name || '', ice: c.ice || '' })}
                    >
                      Situation
                    </button>
                    {deleteArmId === c.id ? (
                      <TimedUndoDelete autoStart deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10}
                        onConfirm={() => { setDeleteArmId(null); openDelete([c.id]); }} />
                    ) : (
                      <TimedUndoDelete deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10} onConfirm={() => { setDeleteArmId(null); openDelete([c.id]); }} />
                    )}
                  </div></td>
                </tr>
              ))}
              {!filtered.length && (
                <tr className="atlas-empty-row">
                  <td colSpan={11}>
                    <EmptyState
                      title="Aucun client"
                      description="Ajoutez vos acheteurs (ICE, contact, limite de crédit) pour facturer plus vite."
                      actionLabel="Ajouter mon premier client"
                      onAction={openCreate}
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
        <FloatingPortal><div className="modal-overlay" onClick={() => { setShow(false); setEditId(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editId ? 'Modifier le client' : 'Nouveau client'}</h2>
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
            <ModalFormError message={modalError} />
            {/* Same action bar pattern as every other form: primary always right */}
            <div className="wizard-foot">
              <div className="wizard-foot-nav">
                <span className="wizard-foot-step">{editId ? 'Modifier le client' : 'Nouveau client'}</span>
                <div className="wizard-foot-actions">
                  <button className="secondary" onClick={() => { setShow(false); setEditId(null); }}>Annuler</button>
                  <button onClick={save} disabled={saving}>
                    {saving ? 'Enregistrement...' : editId ? 'Enregistrer' : 'Créer le client'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div></FloatingPortal>
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

      {mailChoice && (
        <FloatingPortal>
          <div className="modal-overlay" onClick={() => setMailChoice(null)}>
            <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ marginTop: 0 }}>Envoyer un e-mail</h2>
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                Ouvrir la composition vers <strong>{mailChoice.email}</strong>
                {mailChoice.name ? ` (${mailChoice.name})` : ''} ?
              </p>
              <div className="form-actions" style={{ gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    const email = mailChoice.email;
                    setMailChoice(null);
                    if (email) window.location.href = `mailto:${email}`;
                  }}
                >
                  Ouvrir le client mail
                </button>
                <button type="button" className="secondary" onClick={() => setMailChoice(null)}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </FloatingPortal>
      )}

      {sitChoice && (
        <FloatingPortal>
          <div className="modal-overlay" onClick={() => setSitChoice(null)}>
            <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ marginTop: 0 }}>Situation client</h2>
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                {sitChoice.name} — quel rapport ouvrir ?
              </p>
              <div className="form-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    openReport('/api/reports/client-situation', {
                      client_id: String(sitChoice.id),
                      name: sitChoice.name,
                      ice: sitChoice.ice,
                    });
                    setSitChoice(null);
                  }}
                >
                  Synthèse
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    openReport('/api/reports/client-situation', {
                      client_id: String(sitChoice.id),
                      name: sitChoice.name,
                      ice: sitChoice.ice,
                      detail: 'full',
                    });
                    setSitChoice(null);
                  }}
                >
                  Détail complet (produits)
                </button>
                <button type="button" className="secondary" onClick={() => setSitChoice(null)}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
