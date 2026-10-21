import { TimedUndoDelete } from '../components/ui';
import { useEffect, useState } from 'react';
import DatePicker from '../components/DatePicker';
import { api, BASE } from '../api';
import TypeaheadField, { productTypeaheadOptions, partyTypeaheadOptions } from '../components/TypeaheadField';
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
import { FloatingPortal } from '../components/FloatingPortal';
import { useWizard, StepBody, WizardFoot } from '../components/ui/FormWizard';
import { ModalFormError, FieldHint } from '../components/ModalFormFeedback';

const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');

export default function Bills() {
  const { confirm, toast } = useUi();
  const [modalError, setModalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bills, setBills] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const wz = useWizard(3);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [vendorId, setVendorId] = useState<number | ''>('');
  const [vendorName, setVendorName] = useState('');
  const [vendorIce, setVendorIce] = useState('');
  const [vendorAddress, setVendorAddress] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [items, setItems] = useState<{ product_id?: number; product_name: string; sku?: string; quantity: number; unit_cost: number }[]>([{ product_name: '', quantity: 1, unit_cost: 0 }]);
  const [deleteArmId, setDeleteArmId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);

  /* OCR : photo/scan d'une facture fournisseur → champs pré-remplis à vérifier. */
  const runBillOcr = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      flash('Format non pris en charge — image ou PDF uniquement.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      flash('Fichier trop volumineux (max 8 Mo).', 'error');
      return;
    }
    setOcrBusy(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result || ''));
        fr.onerror = () => rej(new Error('lecture impossible'));
        fr.readAsDataURL(file);
      });
      const r: any = await api.parseBillDocument({ data_url: dataUrl });
      const f = r?.data?.fields || {};
      const its = Array.isArray(r?.data?.items) ? r.data.items : [];
      let applied = 0;
      if (f.vendor_name) {
        setVendorName(String(f.vendor_name));
        const match = vendors.find(
          (v) => String(v.name || '').trim().toLowerCase() === String(f.vendor_name).trim().toLowerCase(),
        );
        if (match) { setVendorId(Number(match.id)); setVendorIce(match.ice || ''); setVendorAddress(match.address || ''); }
        applied++;
      }
      if (f.ice && !vendorId) { setVendorIce(String(f.ice)); applied++; }
      if (f.issue_date) { setIssueDate(String(f.issue_date)); applied++; }
      if (f.bill_number) {
        setNotes((n) => (n ? `${n}\n` : '') + `Facture fournisseur n° ${f.bill_number} (import OCR)`);
        applied++;
      }
      if (its.length) {
        setItems(its.map((it: any) => ({ product_name: String(it.product_name), quantity: Number(it.quantity) || 1, unit_cost: Number(it.unit_cost) || 0 })));
        applied++;
      }
      flash(
        applied
          ? r?.data?.review_message || 'Champs pré-remplis — vérifiez avant d’enregistrer.'
          : 'Extraction impossible — vérifiez que la photo est nette, puis saisissez les champs.',
        applied ? 'success' : 'error',
      );
    } catch (e: any) {
      flash(e?.message || 'OCR indisponible pour le moment.', 'error');
    } finally {
      setOcrBusy(false);
    }
  };
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

  
  useEffect(() => {
    const onLists = () => {
      try { load(true); } catch { /* */ }
    };
    window.addEventListener('atlas-lists-refresh', onLists as EventListener);
    return () => window.removeEventListener('atlas-lists-refresh', onLists as EventListener);
  }, []);

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
    if (Object.keys(fe).length) return; // erreurs affichées sous chaque champ
    setSaving(true);
    try {
      await api.createBill({
        vendor_id: vendorId || undefined, vendor_name: vendorName, vendor_ice: vendorIce, vendor_address: vendorAddress,
        issue_date: issueDate, notes, items, status: 'sent',
      });
      setShowModal(false); resetForm();
      flash('Facture d\'achat enregistrée dans la base de données avec succès.');
      load(true);
    } catch (e: any) { setModalError(e?.message || 'Erreur lors de l\'enregistrement.'); } finally { setSaving(false); }
  };

  const remainingOf = (b: any) =>
    Math.max(0, Number(b.total || 0) - Number(b.amount_paid || 0));

  const openPay = async (b: any) => {
    const rest = remainingOf(b);
    if (rest <= 0) {
      flash('Cette facture d\'achat est déjà soldée.', 'error');
      return;
    }
    setModalError('');
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
      setModalError(e?.message || 'Paiement impossible — réessayez.');
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
      setModalError('');
      setReceiveBill(b);
      setReceiveLines(lines);
    } catch (e: any) {
      toast(friendlyError(e, e.message), 'error');
    }
  };

  const submitReceive = async () => {
    if (!receiveBill) return;
    setReceiveBusy(true);
    setModalError('');
    try {
      const payload = {
        items: receiveLines
          .filter((l) => l.add > 0)
          .map((l) => ({ bill_item_id: l.id, qty_received: l.add })),
      };
      if (!payload.items.length) {
        setModalError('Aucune quantité à recevoir.');
        return;
      }
      const r: any = await api.receiveBill(receiveBill.id, payload);
      toast(r.message || 'Réception enregistrée', 'success');
      setReceiveBill(null);
      load(true);
    } catch (e: any) {
      setModalError(friendlyError(e, e.message) || 'Réception impossible — réessayez.');
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
    setPwDesc('Cette action est définitive. Confirmez pour continuer.');
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
    <div className="bills-page">
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
            <TimedUndoDelete
              deleteLabel={`Supprimer (${selected.size})`}
              undoLabel="Annuler"
              initialSeconds={10}
              onConfirm={() => openDelete()}
            />
          )}
          <button className="secondary" onClick={() => openReport('/api/reports/payables')}>PDF Dettes</button>
          <button onClick={() => { setModalError(''); setShowModal(true); }}>+ Nouvelle facture d'achat</button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="ac-panel ac-products-filters">
        <div className="search-bar"><input className="search-input" placeholder="Rechercher par numéro ou nom de fournisseur..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>

      <div className="ac-panel ac-products-table-panel">
        <div className="table-wrap">
          <table className="data-dense ac-products-table">
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
                            setModalError('');
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
                    {deleteArmId === b.id ? (
                      <TimedUndoDelete autoStart deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10}
                        onConfirm={() => { setDeleteArmId(null); openDelete([b.id]); }} />
                    ) : (
                      <TimedUndoDelete deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10} onConfirm={() => { setDeleteArmId(null); openDelete([b.id]); }} />
                    )}
                  </td>
                </tr>
              ))}
              {!filtered.length && !loading && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="Aucune facture d'achat"
                      description="Enregistrez les factures fournisseurs, puis validez la réception pour alimenter le stock (rapprochement 3 voies)."
                      actionLabel="Créer ma première facture d'achat"
                      onAction={() => { setModalError(''); setShowModal(true); }}
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
        <FloatingPortal><div className="modal-overlay" onClick={() => { setShowModal(false); wz.reset(); }}>
          <div className="modal" style={{ maxWidth: 1080, width: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle facture d'achat</h2>

            <label
              className="dropzone"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0] || null;
                if (f && !ocrBusy) runBillOcr(f);
              }}
            >
              <span className="dropzone-ico" aria-hidden>📷</span>
              <span className="dropzone-title">Scanner une facture (OCR) — image ou PDF</span>
              <span className="dropzone-hint">Glissez un fichier ici ou cliquez pour parcourir</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                disabled={ocrBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  e.target.value = '';
                  runBillOcr(f);
                }}
              />
              {ocrBusy && <span className="dropzone-busy">Extraction en cours…</span>}
            </label>
            <p className="dropzone-note">
              Fournisseur, date, numéro, lignes et total sont pré-remplis — rien n'est enregistré sans votre validation.
            </p>

            <StepBody active={wz.step === 1}>
            <div className="form-row">
              <label>Fournisseur enregistré</label>
              <TypeaheadField
                value={vendorName}
                placeholder="Rechercher un fournisseur (nom, ICE)…"
                options={partyTypeaheadOptions(vendors, 'vendor')}
                onChange={(v) => {
                  setVendorName(v);
                  setVendorId('');
                  setFieldErrors((x) => ({ ...x, vendor_name: '' }));
                }}
                onPick={(o) => selectVendor(Number(o.id))}
                emptyLabel="Aucun fournisseur"
              />
            </div>

            <div className="grid grid-2">
              <div className="form-row"><label>Nom du fournisseur *</label><input className={fieldErrors.vendor_name ? 'field-error' : undefined} value={vendorName} onChange={(e) => { setVendorName(e.target.value); setFieldErrors((x) => ({ ...x, vendor_name: '' })); }} placeholder="Ex. Ciments du Maroc" /><span className="field-error-msg">{fieldErrors.vendor_name || ''}</span></div>
              <div className="form-row"><label>ICE / Identifiant fournisseur</label><input value={vendorIce} onChange={(e) => setVendorIce(e.target.value)} /></div>
            </div>
            <div className="grid grid-2">
              <div className="form-row"><label>Adresse</label><input value={vendorAddress} onChange={(e) => setVendorAddress(e.target.value)} /></div>
              <div className="form-row"><label>Date d'émission</label><DatePicker value={issueDate} onChange={setIssueDate} /></div>
            </div>

            </StepBody>
            <StepBody active={wz.step === 2}>
            <h3 style={{ margin: '16px 0 8px', fontSize: 14 }}>Articles — stock à la réception</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.4 }}>
              Choisissez un produit (recherche), le <strong>prix d&apos;achat</strong> se remplit si le coût catalogue existe. Vous pouvez le modifier librement.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 1.3fr 80px 110px 100px 40px',
                gap: 6,
                marginBottom: 6,
                fontSize: 10,
                color: 'var(--muted)',
                fontWeight: 600,
              }}
            >
              <span>Recherche / produit</span>
              <span>Désignation</span>
              <span>Qté</span>
              <span>P.U. achat</span>
              <span>Total</span>
              <span />
            </div>
            {fieldErrors.items ? (
              <span className="field-error-msg" style={{ display: 'block', marginBottom: 8 }}>{fieldErrors.items}</span>
            ) : null}
            {items.map((item, idx) => {
              const lineTotal = Number(item.quantity || 0) * Number(item.unit_cost || 0);
              return (
                <div key={idx} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.6fr 1.3fr 80px 110px 100px 40px',
                      gap: 6,
                      alignItems: 'center',
                    }}
                  >
                    <TypeaheadField
                      value={item.product_name || ''}
                      placeholder="Rechercher nom, SKU…"
                      options={productTypeaheadOptions(products)}
                      onOpen={() => {
                        api.getProducts({ fields: 'light', limit: 500 }).then((r: any) => {
                          if (Array.isArray(r?.data)) setProducts(r.data);
                        }).catch(() => {});
                      }}
                      onChange={(v) => {
                        updateLine(idx, 'product_name', v);
                        updateLine(idx, 'product_id', undefined);
                      }}
                      onPick={(o) => {
                        const prod = products.find((x) => String(x.id) === String(o.id));
                        if (!prod) return;
                        updateLine(idx, 'product_id', prod.id);
                        updateLine(idx, 'product_name', prod.name || '');
                        updateLine(idx, 'unit_cost', Number(prod.cost || prod.cost_price || prod.price || 0));
                        if (prod.sku) updateLine(idx, 'sku', prod.sku);
                      }}
                      emptyLabel="Aucun produit"
                    />
                    <input
                      placeholder="Désignation *"
                      value={item.product_name}
                      onChange={(e) => updateLine(idx, 'product_name', e.target.value)}
                    />
                    <NumberField value={item.quantity} onValueChange={(n) => updateLine(idx, 'quantity', n)} min={0.01} step="0.01" title="Quantité" />
                    <NumberField value={item.unit_cost} onValueChange={(n) => updateLine(idx, 'unit_cost', n)} min={0} step="0.01" title="Prix d’achat" />
                    <div style={{ fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                      {lineTotal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: '6px 8px', minWidth: 40 }}
                      title="Supprimer la ligne"
                      aria-label="Supprimer la ligne"
                      onClick={() =>
                        setItems((prev) =>
                          prev.length <= 1
                            ? [{ product_name: '', quantity: 1, unit_cost: 0 }]
                            : prev.filter((_, i) => i !== idx),
                        )
                      }
                    >
                      ✕
                    </button>
                  </div>
                  {(fieldErrors[`item_qty_${idx}`] || fieldErrors[`item_cost_${idx}`]) ? (
                    <span className="field-error-msg" style={{ display: 'block', marginTop: 4 }}>
                      {fieldErrors[`item_qty_${idx}`] || fieldErrors[`item_cost_${idx}`]}
                    </span>
                  ) : null}
                </div>
              );
            })}
            <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'right', marginBottom: 12 }}>
              Total estimé : {items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_cost || 0), 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH
            </div>
            <button type="button" className="secondary" onClick={() => setItems([...items, { product_name: '', quantity: 1, unit_cost: 0 }])} style={{ marginBottom: 16 }}>
              + Ajouter une ligne
            </button>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0 }}>
              Prix d’achat libre. Le coût catalogue est recalculé en moyenne pondérée à la réception (ancien stock × ancien coût + nouvel achat).
            </p>

            </StepBody>
            <StepBody active={wz.step === 3}>
            <div className="form-row"><label>Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </StepBody>
            <ModalFormError message={modalError || firstError(fieldErrors)} />
            <WizardFoot
              title="Nouvelle facture d'achat"
              wz={wz}
              stepLabel={wz.step === 1 ? 'Fournisseur' : wz.step === 2 ? 'Articles' : 'Notes & validation'}
              onCancel={() => { setShowModal(false); wz.reset(); }}
              onSubmit={() => void create()}
              submitLabel={saving ? 'Enregistrement…' : 'Créer et enregistrer'}
              saving={saving}
            />
          </div>
        </div></FloatingPortal>
      )}

      {payTarget && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { setModalError(''); setPayTarget(null); }}>
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
              <DatePicker value={payDate} onChange={setPayDate} disabled={saving} />
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

            <ModalFormError message={modalError} />
            <div className="form-actions">
              <button type="button" onClick={submitPay} disabled={saving}>
                {saving ? '…' : payMode === 'full' ? 'Valider le règlement intégral' : 'Enregistrer ce paiement'}
              </button>
              <button type="button" className="secondary" onClick={() => { setModalError(''); setPayTarget(null); }} disabled={saving}>Annuler</button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {receiveBill && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { setModalError(''); setReceiveBill(null); }}>
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
            <ModalFormError message={modalError} />
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="button" disabled={receiveBusy} onClick={submitReceive}>
                {receiveBusy ? 'Enregistrement…' : 'Valider la réception'}
              </button>
              <button type="button" className="secondary" onClick={() => { setModalError(''); setReceiveBill(null); }}>Fermer</button>
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
    </div>
  );
}
