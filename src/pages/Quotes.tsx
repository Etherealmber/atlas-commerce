import TypeaheadField, { productTypeaheadOptions, partyTypeaheadOptions } from '../components/TypeaheadField';
import DatePicker from '../components/DatePicker';
import { useEffect, useState } from 'react';
import { api, BASE } from '../api';
import { openPrintDoc } from '../lib/reports';
import { getToken } from '../auth';
import SaveFeedback from '../components/SaveFeedback';
import { statusFr, statusBadgeClass } from '../lib/labels';
import { useUi } from '../components/AppDialogs';
import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import EmptyState from '../components/EmptyState';
import { useWizard, StepBody, WizardFoot } from '../components/ui/FormWizard';
import RefreshIconButton from '../components/RefreshIconButton';
import PasswordConfirm from '../components/PasswordConfirm';
import { FloatingPortal } from '../components/FloatingPortal';
import { ModalFormError } from '../components/ModalFormFeedback';

export default function Quotes() {
  const [modalError, setModalError] = useState('');
  const { confirm } = useUi();
  const [list, setList] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const wz = useWizard(3);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clientDropOpen, setClientDropOpen] = useState(false);
  const [productDropIdx, setProductDropIdx] = useState<number | null>(null);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ product_id?: number; product_name: string; product_query?: string; quantity: number; list_price: number; unit_price: number; tax_rate: number; sku?: string }[]>([
    { product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: 20 },
  ]);
  const [taxExempt, setTaxExempt] = useState(false);
  const [search, setSearch] = useState('');
  const [convertId, setConvertId] = useState<number | null>(null);
  const [detailQuote, setDetailQuote] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLocked, setEditLocked] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('Confirmation');
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);
  const filteredQuotes = list.filter((q) => {
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return (
      String(q.number || '').toLowerCase().includes(s) ||
      String(q.client_name || '').toLowerCase().includes(s) ||
      String(q.status || '').toLowerCase().includes(s) ||
      String(q.notes || '').toLowerCase().includes(s)
    );
  });

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([api.getInvoices('quote'), api.getClients(), api.getProducts()])
      .then(([inv, cl, pr]) => {
        const all = inv.data || [];
        // also include status devis if filtered only quote misses some
        setList(all.filter((x: any) => x.status === 'quote' || x.status === 'devis'));
        setClients(cl.data || []);
        setProducts(pr.data || []);
      })
      .catch(async () => {
        // fallback: get all invoices and filter
        try {
          const inv = await api.getInvoices();
          setList((inv.data || []).filter((x: any) => x.status === 'quote' || x.status === 'devis'));
        } catch { /* ignore */ }
      })
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

  useEffect(() => { load(); }, []);

  const onClient = (id: string) => {
    setClientId(id);
    const c = clients.find((x) => String(x.id) === id);
    if (c) {
      setClientName(c.name);
      setTaxExempt(!!c.tax_exempt);
    } else {
      setTaxExempt(false);
    }
  };

  const setItem = (i: number, patch: Partial<(typeof items)[0]>) => {
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  };

  const pickProduct = (i: number, pid: string) => {
    const p = products.find((x) => String(x.id) === pid);
    if (!p) return;
    const price = Number(p.price || 0);
    setItem(i, {
      product_id: p.id,
      product_name: p.name,
      product_query: p.name,
      sku: p.sku || '',
      list_price: price,
      unit_price: price,
      tax_rate: taxExempt ? 0 : Number(p.tax_rate ?? 20),
    });
  };

  const create = async () => {
    if (!clientName.trim() || !items.some((it) => it.product_name && it.quantity > 0)) {
      setModalError('Client et au moins une ligne sont obligatoires.');
      return;
    }
    setSaving(true);
    try {
      await api.createInvoice({
        client_id: clientId ? Number(clientId) : null,
        client_name: clientName,
        issue_date: issueDate,
        notes,
        status: 'quote',
        tax_exempt: taxExempt,
        items: items.filter((it) => it.product_name && it.quantity > 0).map((it) => ({
          ...it,
          tax_rate: taxExempt ? 0 : it.tax_rate,
        })),
      });
      setShowModal(false);
      setItems([{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: 20 }]);
      setNotes('');
      setTaxExempt(false);
      flash('Devis enregistré (non comptabilisé, stock intact).');
      load(true);
    } catch (e: any) {
      flash(e.message || 'Erreur', 'error');
    } finally {
      setSaving(false);
    }
  };

  const convertTo = async (id: number, target: 'invoice' | 'quick_sale') => {
    setSaving(true);
    try {
      const res: any = await api.convertQuoteToInvoice(id, { target });
      flash(
        res.message ||
          (target === 'quick_sale'
            ? 'Devis converti en vente rapide.'
            : 'Devis converti en facture.'),
      );
      setConvertId(null);
      load(true);
    } catch (e: any) {
      flash(e.message || 'Erreur', 'error');
    } finally {
      setSaving(false);
    }
  };

  const printDoc = (id: number) => {
    openPrintDoc(`/api/invoices/${id}/print`);
  };

  const resetForm = () => {
    setClientId('');
    setClientName('');
    setIssueDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setItems([{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: 20 }]);
    setTaxExempt(false);
    setEditingId(null);
    setEditLocked(false);
    setDetailQuote(null);
  };

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await api.getInvoice(id);
      const data = res.data;
      setDetailQuote(data);
      setEditingId(Number(data.id));
      setClientId(data.client_id ? String(data.client_id) : '');
      setClientName(data.client_name || '');
      setIssueDate((data.issue_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10));
      setNotes(data.notes || '');
      setTaxExempt(!!data.tax_exempt);
      const locked = data.status === 'cancelled';
      setEditLocked(locked);
      const lines = (data.items || []).map((it: any) => ({
        product_id: it.product_id || undefined,
        product_name: it.product_name || '',
        quantity: Number(it.quantity || 0),
        list_price: Number(it.list_price ?? it.catalog_price ?? it.unit_price ?? 0),
        unit_price: Number(it.unit_price || 0),
        tax_rate: Number(it.tax_rate ?? (data.tax_exempt ? 0 : 20)),
        sku: it.sku || '',
      }));
      setItems(lines.length ? lines : [{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: 20 }]);
    } catch (e: any) {
      flash(e?.message || 'Chargement du devis impossible', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (editLocked) {
      flash('Ce devis est annulé et ne peut plus être modifié.', 'error');
      return;
    }
    if (!clientName.trim() || !items.some((it) => it.product_name && it.quantity > 0)) {
      setModalError('Client et au moins une ligne sont obligatoires.');
      return;
    }
    setSaving(true);
    try {
      await api.updateInvoice(editingId, {
        client_id: clientId ? Number(clientId) : null,
        client_name: clientName,
        issue_date: issueDate,
        notes,
        tax_exempt: taxExempt,
        items: items
          .filter((it) => it.product_name && it.quantity > 0)
          .map((it) => ({
            ...it,
            tax_rate: taxExempt ? 0 : it.tax_rate,
          })),
      });
      flash('Devis mis à jour.');
      resetForm();
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Enregistrement impossible', 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelQuote = async (id: number) => {
    const ok = await confirm({
      title: 'Annuler le devis',
      message: 'Le devis passera au statut annulé. Aucun impact stock.',
      confirmLabel: 'Annuler le devis',
      cancelLabel: 'Retour',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.updateInvoiceStatus(id, { status: 'cancelled', void_reason: 'Annulation devis' } as any);
      flash('Devis annulé.');
      resetForm();
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Annulation impossible', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteQuote = (id: number) => {
    setPwTitle('Supprimer le devis');
    setPendingAction(async (password: string) => {
      const res = await api.deleteInvoice(id, password);
      flash((res as any).message || 'Devis supprimé.');
      setPwOpen(false);
      setPendingAction(null);
      resetForm();
      load(true);
    });
    setPwOpen(true);
  };

  const sendQuoteEmail = async (q: any) => {
    const client = clients.find((c) => String(c.id) === String(q.client_id));
    const to = String(q.client_email || client?.email || '').trim();
    if (!to) {
      flash('Aucune adresse e-mail pour ce client.', 'error');
      return;
    }
    try {
      await api.sendInvoiceEmail(q.id, to);
      flash(`E-mail personnalisé envoyé à ${to} (lien PDF inclus).`);
    } catch (e: any) {
      flash(e?.message || 'Envoi impossible', 'error');
    }
  };

  /** Live HT / TVA / TTC for the creation drawer */
  const draftTotals = (() => {
    let ht = 0;
    let tax = 0;
    for (const it of items) {
      const line = Number(it.quantity || 0) * Number(it.unit_price || 0);
      ht += line;
      const rate = taxExempt ? 0 : Number(it.tax_rate ?? 20);
      tax += line * (rate / 100);
    }
    return { ht, tax, ttc: ht + tax };
  })();

  const fmt = (n: number) =>
    Math.round(Number(n || 0)).toLocaleString('fr-FR');

  if (loading) return <div className="empty">Chargement des devis...</div>;

  return (
    <div className="atlas-crm quotes-page">
      <div className="page-header">
        <div>
          <h1>Devis</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
            Estimation avant vente — non comptabilisée. Convertissez en facture pour encaisser et déduire le stock.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button onClick={() => { resetForm(); wz.reset(); setShowModal(true); }}>+ Nouveau devis</button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="ac-panel ac-products-filters">
        <div className="ac-products-filters-row">
          <div className="ac-search-field">
            <input
              className="ac-search-input"
              type="search"
              placeholder="Rechercher n°, client, statut…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Rechercher dans les devis"
            />
          </div>
        </div>
      </div>

      <div className="ac-panel ac-products-table-panel">
        <div className="table-wrap">
          <table className="data-dense ac-products-table">
            <thead>
              <tr>
                <th>N°</th><th>Client</th><th>Date</th><th>Statut</th>
                <th style={{ textAlign: 'right' }}>Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filteredQuotes.map((q) => (
                <tr key={q.id}>
                  <td><strong>{q.number}</strong></td>
                  <td>{q.client_name}</td>
                  <td>{q.issue_date}</td>
                  <td><span className={`badge ${statusBadgeClass(q.status)}`}>{statusFr(q.status)}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(q.total)}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button type="button" className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openDetail(q.id)} disabled={detailLoading}>
                        Ouvrir
                      </button>
                      {q.status !== 'cancelled' && (
                        <button type="button" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setConvertId(q.id)} disabled={saving}>
                          → Facturer
                        </button>
                      )}
                      {q.status !== 'cancelled' && (
                        <button type="button" className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => cancelQuote(q.id)} disabled={saving}>
                          Annuler
                        </button>
                      )}
                      <button type="button" className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteQuote(q.id)} disabled={saving}>
                        Suppr.
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={6}>
                    <EmptyState
                      title="Aucun devis"
                      description="Créez une estimation pour un client. Vous pourrez la convertir en facture ensuite."
                      actionLabel="Créer mon premier devis"
                      onAction={() => { resetForm(); setShowModal(true); }}
                      icon="quote"
                    />
                  </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { if (saving) return; setShowModal(false); resetForm(); wz.reset(); }}>
          <div className="modal" style={{ maxWidth: 1080, width: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau devis</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Non comptabilisé tant qu’il n’est pas converti en facture. Stock non modifié.
            </p>
            <StepBody active={wz.step === 1}>
            <div className="grid grid-2">
              <div className="form-row">
                <label>Client *</label>
                <TypeaheadField
                  value={clientQuery || clientName}
                  placeholder="Rechercher un client…"
                  options={partyTypeaheadOptions(clients, 'client')}
                  onOpen={() => {
                    api.getClients().then((r: any) => {
                      if (Array.isArray(r?.data)) setClients(r.data);
                    }).catch(() => {});
                  }}
                  onChange={(v) => {
                    setClientQuery(v);
                    setClientName(v);
                    setClientId('');
                  }}
                  onPick={(o) => {
                    onClient(String(o.id));
                    setClientQuery(o.label);
                  }}
                  emptyLabel="Aucun client"
                />
              </div>
              <div className="form-row">
                <label>Nom client (libre)</label>
                <input value={clientName} onChange={(e) => { setClientName(e.target.value); setClientQuery(e.target.value); }} placeholder="Monsieur Benane" />
              </div>
            </div>
            <div className="form-row">
              <label>Date</label>
              <DatePicker value={issueDate} onChange={setIssueDate} />
            </div>

            <div className="form-row" style={{ marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!taxExempt}
                  onChange={(e) => {
                    const enableTva = e.target.checked;
                    setTaxExempt(!enableTva);
                    setItems((prev) =>
                      prev.map((row) => ({
                        ...row,
                        tax_rate: enableTva ? (row.tax_rate > 0 ? row.tax_rate : 20) : 0,
                      })),
                    );
                  }}
                />
                TVA activée (désactiver pour total TTC = HT)
              </label>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>
                {taxExempt
                  ? 'TVA désactivée — totaux calculés à 0 %.'
                  : 'TVA activée — taux par ligne (défaut 20 %).'}
              </p>
            </div>

            </StepBody>
            <StepBody active={wz.step === 2}>
            <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Lignes — prix catalogue · prix client (promo)</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              Le <strong>prix catalogue</strong> se remplit au choix du produit. Saisissez le <strong>prix client</strong> pour une promo / remise. Les devis ne touchent jamais le stock.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 70px 90px 90px 70px 44px', gap: 8, marginBottom: 6, fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span>Produit</span><span>Désignation</span><span>Qté</span><span>Catalogue</span><span>Prix client</span><span>Total</span><span></span>
            </div>
            {items.map((it, i) => {
              const listP = Number(it.list_price || 0);
              const unitP = Number(it.unit_price || 0);
              const promo = listP > 0 && unitP < listP;
              return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 70px 90px 90px 70px 44px', gap: 8, alignItems: 'center' }}>
                  <TypeaheadField
                      value={(it as any).product_query ?? it.product_name ?? ''}
                      placeholder="Chercher produit (nom / SKU)…"
                      options={productTypeaheadOptions(products)}
                      onChange={(q) => {
                        setItem(i, { product_name: q, product_id: undefined, product_query: q });
                      }}
                      onPick={(o) => {
                        pickProduct(i, String(o.id));
                      }}
                      onOpen={() => {
                        api.getProducts({ fields: 'light', limit: 500 }).then((r: any) => {
                          if (Array.isArray(r?.data)) setProducts(r.data);
                        }).catch(() => {});
                      }}
                      emptyLabel="Aucun produit"
                    />
                  <input placeholder="Désignation" value={it.product_name} onChange={(e) => setItem(i, { product_name: e.target.value })} />
                  <NumberField value={it.quantity} onValueChange={(n) => setItem(i, { quantity: n })} min={0} step="0.01" />
                  <NumberField value={it.list_price} onValueChange={(n) => setItem(i, { list_price: n })} min={0} step="0.01" title="Prix catalogue" />
                  <NumberField value={it.unit_price} onValueChange={(n) => setItem(i, { unit_price: n })} min={0} step="0.01" title="Prix client (promo)" style={promo ? { borderColor: 'var(--success, #3f3f46)' } : undefined} />
                  <div style={{ fontWeight: 700, textAlign: 'right' }}>{(Number(it.quantity||0)*unitP).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
                  <button
                    type="button"
                    className="secondary"
                    title="Supprimer la ligne"
                    aria-label="Supprimer la ligne"
                    style={{ padding: '6px 8px', minWidth: 40 }}
                    onClick={() =>
                      setItems((prev) => {
                        if (prev.length <= 1) {
                          return [{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: 20 }];
                        }
                        return prev.filter((_, j) => j !== i);
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
                {promo && (
                  <div style={{ fontSize: 11, color: 'var(--success, #3f3f46)', marginTop: 2 }}>
                    Promo −{(listP - unitP).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} / u ({listP > 0 ? (((listP - unitP) / listP) * 100).toFixed(1) : 0} %)
                  </div>
                )}
              </div>
              );
            })}
            <button type="button" className="secondary" style={{ marginBottom: 12 }} onClick={() => setItems([...items, { product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: 20 }])}>
              + Ligne
            </button>
            </StepBody>
            <StepBody active={wz.step === 3}>
            <div className="form-row">
              <label>Notes</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div style={{ margin: '12px 0', padding: '12px 14px', background: 'var(--bg-elevated, #f5f2eb)', borderRadius: 10, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>HT</span><strong>{fmt(draftTotals.ht)} MAD</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TVA</span><strong>{fmt(draftTotals.tax)} MAD</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 16 }}><span>TTC</span><strong>{fmt(draftTotals.ttc)} MAD</strong></div>
            </div>
            <ModalFormError message={modalError} />
            </StepBody>
            <WizardFoot
              wz={wz}
              title="Nouveau devis"
              stepLabel={['Client', 'Lignes', 'Notes'][wz.step - 1]}
              onCancel={() => { setShowModal(false); resetForm(); wz.reset(); }}
              onSubmit={create}
              submitLabel="Enregistrer le devis"
              saving={saving}
            />
          </div>
        </div></FloatingPortal>
      )}

      {convertId != null && (
        <FloatingPortal><div className="modal-overlay" onClick={() => !saving && setConvertId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="convert-quote-title">
            <h2 id="convert-quote-title" style={{ marginTop: 0 }}>Convertir le devis</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>
              Choisissez le document cible. Le stock sera déduit dans les deux cas.
            </p>
            <div className="form-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <button type="button" disabled={saving} onClick={() => convertTo(convertId, 'invoice')}>
                → Facture de vente (FA)
              </button>
              <button type="button" className="secondary" disabled={saving} onClick={() => convertTo(convertId, 'quick_sale')}>
                → Vente rapide (VR)
              </button>
              <button type="button" className="ghost" disabled={saving} onClick={() => setConvertId(null)}>
                Annuler
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {detailQuote && (
        <FloatingPortal><div className="modal-overlay" onClick={() => !saving && resetForm()}>
          <div
            className="modal"
            style={{ maxWidth: 920, width: '96vw', maxHeight: '92vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>
              {editLocked ? 'Devis (lecture seule)' : 'Modifier le devis'} {detailQuote.number}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
              Restez sur cette page — client et lignes sont modifiables ici.
              {editLocked ? ' (annulé : édition bloquée)' : ''}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-row">
                <label>Client</label>
                <select
                  value={clientId}
                  disabled={editLocked || saving}
                  onChange={(e) => onClient(e.target.value)}
                >
                  <option value="">— Choisir —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>Nom client (libre)</label>
                <input
                  value={clientName}
                  disabled={editLocked || saving}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Monsieur Benane"
                />
              </div>
            </div>

            <div className="form-row">
              <label>Date</label>
              <DatePicker
                value={issueDate}
                disabled={editLocked || saving}
                onChange={setIssueDate}
              />
            </div>

            <div className="form-row" style={{ marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: editLocked ? 'default' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!taxExempt}
                  disabled={editLocked || saving}
                  onChange={(e) => {
                    const enableTva = e.target.checked;
                    setTaxExempt(!enableTva);
                    setItems((prev) =>
                      prev.map((row) => ({
                        ...row,
                        tax_rate: enableTva ? (row.tax_rate > 0 ? row.tax_rate : 20) : 0,
                      })),
                    );
                  }}
                />
                TVA activée (désactiver pour total TTC = HT)
              </label>
            </div>

            <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Lignes produit</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 70px 90px 90px 70px 44px', gap: 8, marginBottom: 6, fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span>Produit</span><span>Désignation</span><span>Qté</span><span>Catalogue</span><span>Prix client</span><span>Total</span><span></span>
            </div>
            {items.map((it, i) => {
              const listP = Number(it.list_price || 0);
              const unitP = Number(it.unit_price || 0);
              const promo = listP > 0 && unitP < listP;
              return (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 70px 90px 90px 70px 44px', gap: 8, alignItems: 'center' }}>
                    <input
                      placeholder="Chercher produit (nom / SKU)…"
                      defaultValue=""
                      onChange={(e) => {
                        const q = e.target.value.toLowerCase().trim();
                        if (!q) return;
                        const p = products.find((x) =>
                          String(x.name || '').toLowerCase().includes(q) ||
                          String(x.sku || '').toLowerCase() === q ||
                          String(x.barcode || '') === q
                        );
                        if (p) pickProduct(i, String(p.id));
                      }}
                      list={`qp-${i}`}
                      
                    />
                    <datalist id={`qp-${i}`}>
                      {products.slice(0, 80).map((p) => (
                        <option key={p.id} value={p.name}>{p.sku ? p.sku + ' · ' : ''}{Number(p.price || 0)} MAD</option>
                      ))}
                    </datalist>
                    <input
                      placeholder="Désignation"
                      value={it.product_name}
                      disabled={editLocked || saving}
                      onChange={(e) => setItem(i, { product_name: e.target.value })}
                    />
                    <NumberField value={it.quantity} onValueChange={(n) => setItem(i, { quantity: n })} min={0} step="0.01" disabled={editLocked || saving} />
                    <NumberField value={it.list_price} onValueChange={(n) => setItem(i, { list_price: n })} min={0} step="0.01" disabled={editLocked || saving} title="Prix catalogue" />
                    <NumberField value={it.unit_price} onValueChange={(n) => setItem(i, { unit_price: n })} min={0} step="0.01" disabled={editLocked || saving} title="Prix client" style={promo ? { borderColor: 'var(--success, #3f3f46)' } : undefined} />
                    <div style={{ fontWeight: 700, textAlign: 'right' }}>{(Number(it.quantity || 0) * unitP).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
                    <button
                      type="button"
                      className="secondary"
                      title="Supprimer la ligne"
                      disabled={editLocked || saving || items.length <= 1}
                      style={{ padding: '6px 8px', minWidth: 40 }}
                      onClick={() =>
                      setItems((prev) => {
                        if (prev.length <= 1) {
                          return [{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: 20 }];
                        }
                        return prev.filter((_, j) => j !== i);
                      })
                    }
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
            {!editLocked && (
              <button
                type="button"
                className="secondary"
                style={{ marginBottom: 12 }}
                disabled={saving}
                onClick={() => setItems([...items, { product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: taxExempt ? 0 : 20 }])}
              >
                + Ligne
              </button>
            )}

            <div className="form-row">
              <label>Notes</label>
              <textarea rows={2} value={notes} disabled={editLocked || saving} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div style={{ margin: '12px 0', padding: '12px 14px', background: 'var(--bg-elevated, #f5f2eb)', borderRadius: 10, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>HT</span><strong>{fmt(draftTotals.ht)} MAD</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TVA</span><strong>{fmt(draftTotals.tax)} MAD</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 16 }}><span>TTC</span><strong>{fmt(draftTotals.ttc)} MAD</strong></div>
            </div>

            <div className="form-actions" style={{ flexWrap: 'wrap' }}>
              {!editLocked && (
                <button type="button" onClick={saveEdit} disabled={saving}>
                  {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
                </button>
              )}
              <button type="button" className="secondary" onClick={() => printDoc(detailQuote.id)}>PDF</button>
              <button type="button" className="secondary" onClick={() => sendQuoteEmail(detailQuote)}>E-mail</button>
              {!editLocked && detailQuote.status !== 'cancelled' && (
                <button type="button" onClick={() => { const id = detailQuote.id; resetForm(); setConvertId(id); }}>
                  → Facturer
                </button>
              )}
              {!editLocked && (
                <button type="button" className="danger" onClick={() => cancelQuote(detailQuote.id)} disabled={saving}>
                  Annuler le devis
                </button>
              )}
              <button type="button" className="secondary" onClick={() => resetForm()} disabled={saving}>
                Fermer
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {pwOpen && pendingAction && (
        <PasswordConfirm
          open={pwOpen}
          title={pwTitle}
          onCancel={() => { setPwOpen(false); setPendingAction(null); }}
          onConfirm={async (password: string) => {
            try {
              await pendingAction(password);
            } catch (e: any) {
              flash(e?.message || 'Action refusée', 'error');
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}
