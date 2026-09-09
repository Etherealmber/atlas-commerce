import { useEffect, useState } from 'react';
import { api, BASE } from '../api';
import { getToken } from '../auth';
import SaveFeedback from '../components/SaveFeedback';
import EmptyState from '../components/EmptyState';
import { openReport } from '../lib/reports';
import { statusFr, statusBadgeClass } from '../lib/labels';
import PasswordConfirm from '../components/PasswordConfirm';
import { useUi } from '../components/AppDialogs';
import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import { friendlyError } from '../lib/errors';
import { validateBillForm, firstError } from '../lib/formValidate';
import { PAYMENT_METHODS, paymentMethodLabel } from '../lib/money';
import RefreshIconButton from '../components/RefreshIconButton';

const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');

export default function Bills() {
  const { confirm, toast } = useUi();
  const [bills, setBills] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [vendorId, setVendorId] = useState<number | ''>('');
  const [vendorName, setVendorName] = useState('');
  const [vendorIce, setVendorIce] = useState('');
  const [vendorAddress, setVendorAddress] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [items, setItems] = useState<{ product_id?: number; product_name: string; sku?: string; quantity: number; unit_cost: number }[]>([{ product_name: '', quantity: 1, unit_cost: 0 }]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);
  const [receiveBill, setReceiveBill] = useState<any>(null);
  const [receiveLines, setReceiveLines] = useState<{ id: number; product_name: string; ordered: number; received: number; add: number }[]>([]);
  const [receiveBusy, setReceiveBusy] = useState(false);
  // Split payments (like invoices)
  const [payTarget, setPayTarget] = useState<any>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('cash');
  const [payNote, setPayNote] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMode, setPayMode] = useState<'full' | 'partial'>('partial');
  const [payHistory, setPayHistory] = useState<any[]>([]);

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([api.getBills(filter || undefined), api.getProducts(), api.getVendors()])
      .then(([b, p, v]) => { setBills(b.data); setProducts(p.data); setVendors(v.data); })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => { load(); }, [filter]);

  const selectVendor = (id: number | '') => {
    setVendorId(id);
    if (id) {
      const v = vendors.find((x) => x.id === id);
      if (v) { setVendorName(v.name); setVendorIce(v.ice || ''); setVendorAddress(v.address || ''); }
    } else { setVendorName(''); setVendorIce(''); setVendorAddress(''); }
  };

  const updateLine = (idx: number, field: string, value: any) => {
    const next = [...items];
    (next[idx] as any)[field] = value;
    if (field === 'product_id' && value) {
      const p = products.find((x) => x.id === +value);
      if (p) { next[idx].product_name = p.name; next[idx].sku = p.sku; next[idx].unit_cost = p.cost || 0; }
    }
    setItems(next);
  };

  const resetForm = () => {
    setVendorId(''); setVendorName(''); setVendorIce(''); setVendorAddress(''); setNotes('');
    setItems([{ product_name: '', quantity: 1, unit_cost: 0 }]);
  };

  const create = async () => {
    const fe = validateBillForm({ vendor_name: vendorName, items });
    setFieldErrors(fe);
    if (Object.keys(fe).length) { flash(firstError(fe) || 'Complétez le formulaire.', 'error'); return; }
    setSaving(true);
    try {
      await api.createBill({
        vendor_id: vendorId || undefined, vendor_name: vendorName, vendor_ice: vendorIce, vendor_address: vendorAddress,
        issue_date: issueDate, notes, items, status: 'sent',
      });
      setShowModal(false); resetForm();
      flash('Facture d\'achat enregistrée dans la base de données avec succès.');
      load(true);
    } catch (e: any) { flash(e.message || 'Erreur lors de l\'enregistrement.', 'error'); } finally { setSaving(false); }
  };

  const remainingOf = (b: any) =>
    Math.max(0, Number(b.total || 0) - Number(b.amount_paid || 0));

  const openPay = async (b: any) => {
    const rest = remainingOf(b);
    if (rest <= 0) {
      flash('Cette facture d\'achat est déjà soldée.', 'error');
      return;
    }
    setPayTarget(b);
    setPayAmount(rest);
    setPayMethod('cash');
    setPayNote('');
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMode('full');
    try {
      const r: any = await api.getBillPayments(b.id);
      setPayHistory(r.data || []);
    } catch {
      setPayHistory([]);
    }
  };

  const submitPay = async () => {
    if (!payTarget) return;
    const rest = remainingOf(payTarget);
    const amount = payMode === 'full' ? rest : Number(payAmount);
    if (!amount || amount <= 0) {
      flash('Montant invalide', 'error');
      return;
    }
    if (amount > rest + 0.001) {
      flash(`Le montant ne peut pas dépasser le reste dû (${fmt(rest)}).`, 'error');
      return;
    }
    setSaving(true);
    try {
      const payee = payMethod.includes('owner') ? 'owner' : 'company';
      const res: any = await api.recordBillPayment(payTarget.id, {
        amount,
        payment_method: payMethod,
        payee,
        note: payNote || (payMode === 'full' ? 'Règlement intégral' : ''),
        paid_at: payDate,
      });
      flash(res.message || 'Paiement enregistré');
      setPayTarget(null);
      load(true);
    } catch (e: any) {
      flash(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openReceive = async (b: any) => {
    try {
      const r: any = await api.getBillMatch(b.id);
      const lines = (r.data?.lines || []).map((l: any) => ({
        id: l.id,
        product_name: l.product_name || '—',
        ordered: Number(l.ordered || 0),
        received: Number(l.received || 0),
        add: Math.max(0, Number(l.ordered || 0) - Number(l.received || 0)),
      }));
      setReceiveBill(b);
      setReceiveLines(lines);
    } catch (e: any) {
      toast(friendlyError(e, e.message), 'error');
    }
  };

  const submitReceive = async () => {
    if (!receiveBill) return;
    setReceiveBusy(true);
    try {
      const payload = {
        items: receiveLines
          .filter((l) => l.add > 0)
          .map((l) => ({ bill_item_id: l.id, qty_received: l.add })),
      };
      if (!payload.items.length) {
        toast('Aucune quantité à recevoir', 'error');
        return;
      }
      const r: any = await api.receiveBill(receiveBill.id, payload);
      toast(r.message || 'Réception enregistrée', 'success');
      setReceiveBill(null);
      load(true);
    } catch (e: any) {
      toast(friendlyError(e, e.message), 'error');
    } finally {
      setReceiveBusy(false);
    }
  };

  const cancelBill = async (id: number) => {
    const ok = await confirm({ message: 'Annuler cette facture d\'achat ?', title: 'Annulation', danger: true });
    if (!ok) return;
    try { await api.updateBillStatus(id, { status: 'cancelled' }); flash('Facture d\'achat annulée.'); load(true); }
    catch (e: any) { flash(e.message, 'error'); }
  };

  const openDelete = (ids?: number[]) => {
    const targetIds = ids && ids.length ? ids : Array.from(selected);
    if (!targetIds.length) { flash('Sélectionnez au moins une facture.', 'error'); return; }
    setSelected(new Set(targetIds));
    setPwTitle(targetIds.length === 1 ? 'Supprimer la facture' : `Supprimer ${targetIds.length} factures`);
    setPwDesc('Cette action est définitive. Saisissez votre mot de passe pour confirmer.');
    setPendingAction(() => async (password: string) => {
      const res = targetIds.length === 1
        ? await api.deleteBill(targetIds[0], password)
        : await api.bulkDeleteBills(targetIds, password);
      flash((res as any).message || 'Facture(s) supprimée(s).');
      setPwOpen(false); setPendingAction(null);
      setSelected(new Set());
      load(true);
    });
    setPwOpen(true);
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filtered = bills.filter((b) => !search || b.number?.toLowerCase().includes(search.toLowerCase()) || b.vendor_name?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="empty">Chargement des factures d'achat...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Factures d'achat</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            <option value="sent">Non payées / envoyées</option>
            <option value="partial">Partiellement payées</option>
            <option value="paid">Payées</option>
            <option value="cancelled">Annulées</option>
          </select>
          {selected.size > 0 && (
            <button className="danger" onClick={() => openDelete()}>
              Supprimer la sélection ({selected.size})
            </button>
          )}
          <button className="secondary" onClick={() => openReport('/api/reports/payables')}>PDF Dettes</button>
          <button onClick={() => setShowModal(true)}>+ Nouvelle facture d'achat</button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="search-bar"><input className="search-input" placeholder="Rechercher par numéro ou nom de fournisseur..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((b) => selected.has(b.id))}
                    onChange={() => {
                      const all = filtered.length > 0 && filtered.every((b) => selected.has(b.id));
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (all) filtered.forEach((b) => next.delete(b.id));
                        else filtered.forEach((b) => next.add(b.id));
                        return next;
                      });
                    }}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <th>Numéro</th><th>Fournisseur</th><th>Date</th><th>Statut</th><th>Total</th><th>Payé</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggleOne(b.id)}
                      aria-label={`Sélectionner ${b.number}`}
                    />
                  </td>
                  <td>{b.number}</td>
                  <td>
                    {b.vendor_name}
                    {b.vendor_id && <small style={{ display: 'block', color: 'var(--muted)', fontSize: 11 }}>Fiche fournisseur #{b.vendor_id}</small>}
                  </td>
                  <td>{b.issue_date}</td>
                  <td><span className={`badge ${statusBadgeClass(b.status)}`}>{statusFr(b.status)}</span></td>
                  <td style={{ fontWeight: 700 }}>{fmt(b.total)}</td>
                  <td>
                    {fmt(b.amount_paid || 0)}
                    {remainingOf(b) > 0.001 && b.status !== 'cancelled' && (
                      <small style={{ display: 'block', color: 'var(--bad)', fontSize: 11 }}>Reste {fmt(remainingOf(b))}</small>
                    )}
                  </td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <a className="btn secondary" style={{ padding: '4px 10px', fontSize: 12 }} href={`${BASE}/api/bills/${b.id}/print?token=${encodeURIComponent(getToken() || '')}`} target="_blank" rel="noreferrer">Imprimer</a>
                    {b.status !== 'cancelled' && (
                      <button type="button" className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openReceive(b)}>
                        Réception
                      </button>
                    )}
                    {b.receive_status && (
                      <span className={`receive-status-${b.receive_status || 'pending'}`}>
                        {b.receive_status === 'matched' ? '3-voies OK' : b.receive_status === 'partial' ? 'Récep. partielle' : ''}
                      </span>
                    )}
                    {b.status !== 'paid' && b.status !== 'cancelled' && (
                      <>
                        <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openPay(b)}>Paiement…</button>
                        <button
                          className="success"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={async () => {
                            setPayTarget(b);
                            setPayAmount(remainingOf(b));
                            setPayMethod('cash');
                            setPayNote('Règlement intégral');
                            setPayDate(new Date().toISOString().slice(0, 10));
                            setPayMode('full');
                            setPayHistory([]);
                          }}
                        >
                          Tout payer
                        </button>
                      </>
                    )}
                    {b.status !== 'cancelled' && (
                      <button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => cancelBill(b.id)}>Annuler</button>
                    )}
                    <button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openDelete([b.id])}>Suppr.</button>
                  </td>
                </tr>
              ))}
              {!filtered.length && !loading && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="Aucune facture d'achat"
                      description="Enregistrez les factures fournisseurs, puis validez la réception pour alimenter le stock (rapprochement 3 voies)."
                      actionLabel="Nouvelle facture d'achat"
                      onAction={() => setShowModal(true)}
                      icon="package"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 1080, width: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle facture d'achat</h2>

            <div className="form-row">
              <label>Fournisseur enregistré</label>
              <select value={vendorId} onChange={(e) => selectVendor(e.target.value ? numFromInput(e.target.value) : '')}>
                <option value="">— Saisie manuelle ou nouveau fournisseur —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.ice ? ` (ICE ${v.ice})` : ''}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-2">
              <div className="form-row"><label>Nom du fournisseur *</label><input className={fieldErrors.vendor_name ? 'field-error' : undefined} value={vendorName} onChange={(e) => { setVendorName(e.target.value); setFieldErrors((x) => ({ ...x, vendor_name: '' })); }} placeholder="Ex. Ciments du Maroc" /><span className="field-error-msg">{fieldErrors.vendor_name || ''}</span></div>
              <div className="form-row"><label>ICE / Identifiant fournisseur</label><input value={vendorIce} onChange={(e) => setVendorIce(e.target.value)} /></div>
            </div>
            <div className="form-row"><label>Adresse</label><input value={vendorAddress} onChange={(e) => setVendorAddress(e.target.value)} /></div>
            <div className="form-row"><label>Date d'émission</label><input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>

            <h3 style={{ margin: '16px 0 8px', fontSize: 14 }}>Articles (stock à la réception)</h3>
            {items.map((item, idx) => (
              <div key={idx} className="grid" style={{ gridTemplateColumns: '1.5fr 80px 100px 40px', gap: 8, marginBottom: 8 }}>
                <select value={item.product_id || ''} onChange={(e) => updateLine(idx, 'product_id', e.target.value ? numFromInput(e.target.value) : undefined)}>
                  <option value="">— Produit du stock ou saisie libre —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {!item.product_id && <input placeholder="Désignation" value={item.product_name} onChange={(e) => updateLine(idx, 'product_name', e.target.value)} />}
                <NumberField value={item.quantity} onValueChange={(n) => updateLine(idx, 'quantity', n)} min={0.01} step="0.01" title="Quantité" />
                <NumberField value={item.unit_cost} onValueChange={(n) => updateLine(idx, 'unit_cost', n)} min={0} step="0.01" title="Prix d’achat réel (peut être inférieur ou supérieur au coût catalogue)" />
                <button type="button" className="danger" style={{ padding: '4px 8px' }} onClick={() => setItems(items.filter((_, i) => i !== idx))} aria-label="Supprimer la ligne">×</button>
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => setItems([...items, { product_name: '', quantity: 1, unit_cost: 0 }])} style={{ marginBottom: 16 }}>+ Ajouter une ligne</button>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Prix d’achat libre. Le coût catalogue du produit est recalculé en moyenne pondérée (ancien stock × ancien coût + nouvel achat) — méthode standard quand les prix d’achat changent.</p>

            <div className="form-row"><label>Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="form-actions">
              {firstError(fieldErrors) && <span className="save-error-inline">{firstError(fieldErrors)}</span>}
              <button onClick={create} disabled={saving}>{saving ? 'Enregistrement…' : 'Créer et enregistrer'}</button>
              <button type="button" className="secondary" onClick={() => setShowModal(false)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {payTarget && (
        <div className="modal-overlay" onClick={() => setPayTarget(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>
              {payMode === 'full' ? 'Règlement intégral' : 'Paiement partiel'} — {payTarget.number}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Fournisseur : <strong>{payTarget.vendor_name}</strong>
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 10,
                marginBottom: 16,
                padding: 12,
                background: 'var(--stone, #f5f2eb)',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Total</div>
                <strong>{fmt(payTarget.total)}</strong>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Déjà payé</div>
                <strong>{fmt(payTarget.amount_paid || 0)}</strong>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Reste dû</div>
                <strong style={{ color: 'var(--bad, #8b2e2e)' }}>{fmt(remainingOf(payTarget))}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                className={payMode === 'partial' ? '' : 'secondary'}
                style={{ fontSize: 13, padding: '6px 12px' }}
                onClick={() => {
                  setPayMode('partial');
                  setPayAmount(Math.min(payAmount || remainingOf(payTarget), remainingOf(payTarget)));
                }}
              >
                Partiel
              </button>
              <button
                type="button"
                className={payMode === 'full' ? '' : 'secondary'}
                style={{ fontSize: 13, padding: '6px 12px' }}
                onClick={() => {
                  setPayMode('full');
                  setPayAmount(remainingOf(payTarget));
                }}
              >
                Tout payer
              </button>
            </div>

            <div className="form-row">
              <label>Montant à régler maintenant</label>
              <NumberField
                min={0.01}
                step="0.01"
                value={payAmount}
                onValueChange={(v) => {
                  const max = remainingOf(payTarget);
                  const clamped = Math.min(v, max);
                  setPayAmount(clamped);
                  setPayMode(clamped >= max - 0.001 ? 'full' : 'partial');
                }}
                disabled={payMode === 'full' || saving}
              />
            </div>

            <div className="form-row">
              <label>Mode de paiement *</label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} disabled={saving}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label>Date du paiement</label>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} disabled={saving} />
            </div>

            <div className="form-row">
              <label>Note (optionnel)</label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Ex. chèque n°…, référence virement…"
                disabled={saving}
              />
            </div>

            {payHistory.length > 0 && (
              <div style={{ marginTop: 12, marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>Historique des paiements</strong>
                <table style={{ marginTop: 6, fontSize: 12 }}>
                  <thead>
                    <tr><th>Date</th><th>Montant</th><th>Mode</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {payHistory.map((p) => (
                      <tr key={p.id}>
                        <td>{String(p.paid_at || '').slice(0, 10)}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(p.amount)}</td>
                        <td>{paymentMethodLabel(p.payment_method)}</td>
                        <td>{p.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="form-actions">
              <button type="button" onClick={submitPay} disabled={saving}>
                {saving ? '…' : payMode === 'full' ? 'Valider le règlement intégral' : 'Enregistrer ce paiement'}
              </button>
              <button type="button" className="secondary" onClick={() => setPayTarget(null)} disabled={saving}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {receiveBill && (
        <div className="modal-overlay" onClick={() => setReceiveBill(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Réception — {receiveBill.number}</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
              Indiquez la quantité reçue maintenant. Le stock augmente pour les produits liés.
              Quand commandé = reçu = facturé → rapprochement 3 voies OK.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Commandé</th>
                  <th>Déjà reçu</th>
                  <th>À recevoir</th>
                </tr>
              </thead>
              <tbody>
                {receiveLines.map((l, idx) => (
                  <tr key={l.id}>
                    <td>{l.product_name}</td>
                    <td>{l.ordered}</td>
                    <td>{l.received}</td>
                    <td style={{ maxWidth: 100 }}>
                      <NumberField
                        min={0}
                        max={Math.max(0, l.ordered - l.received)}
                        step="0.01"
                        value={l.add}
                        onValueChange={(n) => {
                          const next = [...receiveLines];
                          next[idx] = { ...l, add: Math.min(Math.max(0, n), Math.max(0, l.ordered - l.received)) };
                          setReceiveLines(next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
                {!receiveLines.length && (
                  <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Aucune ligne.</td></tr>
                )}
              </tbody>
            </table>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="button" disabled={receiveBusy} onClick={submitReceive}>
                {receiveBusy ? 'Enregistrement…' : 'Valider la réception'}
              </button>
              <button type="button" className="secondary" onClick={() => setReceiveBill(null)}>Fermer</button>
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
