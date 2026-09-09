import { suggestExpenseCategory } from '../lib/assist';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import SaveFeedback from '../components/SaveFeedback';
import PasswordConfirm from '../components/PasswordConfirm';
import { openReport } from '../lib/reports';
import { downloadExport } from '../lib/export';
import { useUi } from '../components/AppDialogs';
import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import EmptyState from '../components/EmptyState';
import { validateBalanceEntry, firstError } from '../lib/formValidate';
import RefreshIconButton from '../components/RefreshIconButton';

const EXPENSE_CATEGORIES = [
  'Fournitures de bureau', 'Équipement', 'Électronique', 'Loyer',
  'Charges (eau, électricité, telecom)', 'Transport de marchandises', 'Transport personnel',
  'Carburant', 'Marketing & publicité', 'Maintenance & réparations',
  'Salaires & charges sociales', 'CNSS / AMO',
  'TVA déductible', 'Impôt sur les sociétés (IS)', 'Impôt sur le revenu (IR)',
  'Taxe professionnelle', 'Droits de douane', 'Honoraires (expert-comptable, avocat)',
  'Assurances', 'Matière première', 'Emballage & logistique', 'Formation', 'Autre charge déductible',
];
const INCOME_CATEGORIES = [
  'Vente divers', 'Prestation de service', 'Remboursement', 'Subvention', 'Intérêts', 'Autre recette',
];
const OWNER_DRAW_CATEGORIES = ['Prélèvement personnel', 'Dividende', 'Remboursement associé', 'Autre prélèvement'];
const OWNER_CONTRIB_CATEGORIES = ['Apport en capital', 'Apport en compte courant', 'Autre apport'];

type EntryType = 'expense' | 'income' | 'owner_draw' | 'owner_contrib';

const TYPE_META: Record<EntryType, { label: string; direction: 'in' | 'out'; badge: string }> = {
  expense: { label: 'Dépense', direction: 'out', badge: 'danger' },
  income: { label: 'Recette', direction: 'in', badge: 'success' },
  owner_draw: { label: 'Prélèvement propriétaire', direction: 'out', badge: 'warning' },
  owner_contrib: { label: 'Apport propriétaire', direction: 'in', badge: 'info' },
};

function catsFor(t: EntryType) {
  if (t === 'income') return INCOME_CATEGORIES;
  if (t === 'owner_draw') return OWNER_DRAW_CATEGORIES;
  if (t === 'owner_contrib') return OWNER_CONTRIB_CATEGORIES;
  return EXPENSE_CATEGORIES;
}

function isCash(method?: string) {
  return !method || method === 'cash';
}

export default function Balance() {
  const { confirm, prompt } = useUi();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);
  const [reconcile, setReconcile] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [entryType, setEntryType] = useState<EntryType>('expense');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendorName, setVendorName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [filterType, setFilterType] = useState<'all' | EntryType>('all');
  const [reportPeriod, setReportPeriod] = useState('month');

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([api.getExpenses(), api.getDashboard()])
      .then(([e, d]) => { setExpenses(e.data); setDashboard(d.data); })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };
  useEffect(() => { load(); }, []);

  const openNew = (type: EntryType) => {
    setEntryType(type);
    setCategory(catsFor(type)[0]);
    setDescription(''); setAmount(0); setVendorName(''); setNotes('');
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setPaymentMethod('cash');
    setShowModal(true);
  };

  const create = async () => {
    const fe = validateBalanceEntry({ description, amount }); setFieldErrors(fe); if (Object.keys(fe).length) { flash(firstError(fe) || 'Complétez l’écriture.', 'error'); return; }
    setSaving(true);
    try {
      await api.createExpense({
        category, description, amount, payment_method: paymentMethod,
        expense_date: expenseDate, vendor_name: vendorName, notes,
        entry_type: entryType,
      });
      setShowModal(false);
      flash(TYPE_META[entryType].label + ' enregistré(e).');
      load(true);
    } catch (e: any) { flash(e.message, 'error'); } finally { setSaving(false); }
  };

  const remove = async (id: number) => {
    let disclaimer = 'Supprimer cette écriture ? Le solde sera recalculé.';
    let doCascade = false;
    try {
      const links = await api.getExpenseLinks(id);
      if (links.data?.disclaimer || links.data?.invoice || (links.data?.receipts || []).length) {
        const inv = links.data.invoice ? `facture ${links.data.invoice.number}` : null;
        const recs = (links.data.receipts || []).map((r: any) => r.number).join(', ');
        disclaimer =
          `Cette écriture est liée${inv ? ' à la ' + inv : ''}${recs ? (inv ? ' et ' : ' au ') + 'reçu(s) ' + recs : ''}.\n` +
          `Les écritures liées peuvent être supprimées en cascade.`;
        // Ask cascade BEFORE password so dialogs never stack
        doCascade = await confirm({
          title: 'Suppression liée',
          message: 'Supprimer aussi la facture / les reçus liés ?\nOui = cascade (tout), Non = solde uniquement.',
          confirmLabel: 'Tout supprimer',
          cancelLabel: 'Solde uniquement',
          danger: true,
        });
      }
    } catch { /* ignore */ }

    setPwTitle('Supprimer l\'écriture de solde');
    setPwDesc(disclaimer);
    setPendingAction(() => async (password: string) => {
      await api.deleteExpense(id, password, doCascade);
      flash(doCascade ? 'Écriture et éléments liés supprimés.' : 'Écriture solde supprimée.');
      setPwOpen(false); setPendingAction(null);
      load(true);
      loadReconcile();
    });
    setPwOpen(true);
  };

  const loadReconcile = () => {
    api.getLedgerReconcile().then((r) => setReconcile(r.data)).catch(() => setReconcile(null));
  };

  useEffect(() => { loadReconcile(); }, []);

  const fixReceipts = () => {
    setPwTitle('Créer les reçus manquants');
    setPwDesc('Génère un reçu pour chaque facture payée qui n\'en a pas encore.');
    setPendingAction(() => async (password: string) => {
      const res: any = await api.fixMissingReceipts(password);
      flash(res.message || 'Reçus générés.');
      setPwOpen(false); setPendingAction(null);
      loadReconcile();
    });
    setPwOpen(true);
  };

  const fmt = (n: number) =>
    Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const cur = dashboard?.currency || 'MAD';

  const stats = useMemo(() => {
    let cashIn = 0, cashOut = 0, bankIn = 0, bankOut = 0;
    let income = 0, expense = 0, ownerDraw = 0, ownerContrib = 0;
    for (const e of expenses) {
      const t = (e.entry_type || 'expense') as EntryType;
      const amt = Number(e.amount || 0);
      const cash = isCash(e.payment_method);
      const isIn = t === 'income' || t === 'owner_contrib';
      if (t === 'income') income += amt;
      else if (t === 'owner_draw') ownerDraw += amt;
      else if (t === 'owner_contrib') ownerContrib += amt;
      else expense += amt;
      if (isIn) {
        if (cash) cashIn += amt; else bankIn += amt;
      } else {
        if (cash) cashOut += amt; else bankOut += amt;
      }
    }
    return { cashIn, cashOut, bankIn, bankOut, income, expense, ownerDraw, ownerContrib };
  }, [expenses]);

  const rows = expenses
    .filter((e) => {
      const t = (e.entry_type || 'expense') as EntryType;
      return filterType === 'all' || filterType === t;
    })
    .map((e) => {
      const t = (e.entry_type || 'expense') as EntryType;
      return {
        id: e.id,
        date: e.expense_date,
        type: t,
        label: e.description,
        category: e.category,
        amount: Number(e.amount),
        method: e.payment_method,
        direction: TYPE_META[t]?.direction || 'out',
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (loading)
    return (
      <div className="atlas-page">
        <div className="skeleton" style={{ height: 14, width: 120, marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 32, width: 260, marginBottom: 18 }} />
        <div className="atlas-loading-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      </div>
    );

  const balance = Number(dashboard?.currentBalance || 0);
  const moneyIn = Number(dashboard?.salesReceived || 0) + Number(dashboard?.otherIncomeTotal || 0) + Number(dashboard?.ownerContribTotal || 0);
  const moneyOut = Number(dashboard?.purchasesPaid || 0) + Number(dashboard?.expensesTotal || 0) + Number(dashboard?.ownerDrawTotal || 0);

  const methodLabel = (m?: string) => {
    if (!m || m === 'cash') return 'Espèces';
    if (m === 'bank') return 'Banque';
    if (m === 'card') return 'Carte';
    if (m === 'check') return 'Chèque';
    return m;
  };

  return (
    <div className="atlas-page">
      <p className="atlas-eyebrow">Trésorerie</p>
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="atlas-hello" style={{ fontSize: '1.75rem' }}>Solde &amp; mouvements</h1>
          <p className="atlas-lead" style={{ marginBottom: 0 }}>
            Caisse, banque, apports et prélèvements. Rapports PDF imprimables.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button className="secondary" onClick={() => openNew('income')}>+ Recette</button>
          <button className="secondary" onClick={() => openNew('owner_contrib')}>+ Apport</button>
          <button className="secondary" onClick={() => openNew('owner_draw')}>+ Prélèvement</button>
          <button onClick={() => openNew('expense')}>+ Dépense</button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="atlas-stat-grid">
        <div className="atlas-stat paper">
          <div className="as-label">Solde actuel</div>
          <div className="as-value" style={{ fontSize: '1.15rem' }}>
            {balance.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} MAD
          </div>
          <div className="as-hint">caisse &amp; banque</div>
        </div>
        <div className="atlas-stat mint">
          <div className="as-label">Entrées</div>
          <div className="as-value" style={{ fontSize: '1.15rem' }}>
            {moneyIn.toLocaleString('fr-FR', { minimumFractionDigits: 0 })} MAD
          </div>
          <div className="as-hint">ventes + recettes + apports</div>
        </div>
        <div className="atlas-stat blush">
          <div className="as-label">Sorties</div>
          <div className="as-value" style={{ fontSize: '1.15rem' }}>
            {moneyOut.toLocaleString('fr-FR', { minimumFractionDigits: 0 })} MAD
          </div>
          <div className="as-hint">achats + dépenses + prélèvements</div>
        </div>
        <div className="atlas-stat sand">
          <div className="as-label">Flux net</div>
          <div className="as-value" style={{ fontSize: '1.15rem' }}>
            {(moneyIn - moneyOut).toLocaleString('fr-FR', { minimumFractionDigits: 0 })} MAD
          </div>
          <div className="as-hint">entrées − sorties</div>
        </div>
      </div>

      <BankCsvReconcile />

      {reconcile && (
        <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', background: reconcile.summary?.ok ? 'rgba(45,90,45,0.08)' : 'rgba(139,46,46,0.08)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong style={{ fontSize: 15 }}>Rapprochement comptable</strong>
              <p style={{ fontSize: 13, margin: '4px 0 0', color: reconcile.summary?.ok ? 'var(--success, #2d5a2d)' : 'var(--bad, #8b2e2e)' }}>
                {reconcile.summary?.ok ? 'Solde et paiements cohérents' : (reconcile.summary?.message || 'Écarts détectés')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <RefreshIconButton onClick={loadReconcile} />
              {(reconcile.paid_without_receipt || []).length > 0 && (
                <button type="button" style={{ fontSize: 12 }} onClick={fixReceipts}>
                  Générer {reconcile.paid_without_receipt.length} reçu(s)
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 0 }}>
            {[
              { label: 'Paiements factures', value: reconcile.payments_count, warn: false },
              { label: 'Encaissements solde', value: reconcile.ledger_income_count, warn: false },
              { label: 'Reçus', value: reconcile.receipts_count, warn: false },
              { label: 'Paiements sans solde', value: (reconcile.unmatched_payments || []).length, warn: true },
              { label: 'Solde orphelin', value: (reconcile.orphan_ledger || []).length, warn: true },
              { label: 'Payées sans reçu', value: (reconcile.paid_without_receipt || []).length, warn: true },
            ].map((c) => (
              <div key={c.label} style={{ padding: '14px 16px', borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: c.warn && Number(c.value) > 0 ? 'var(--bad, #8b2e2e)' : 'inherit' }}>
                  {c.value ?? 0}
                </div>
              </div>
            ))}
          </div>
          {(reconcile.unmatched_payments || []).length > 0 && (
            <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--muted)' }}>
              Ex. paiements sans écriture solde : {(reconcile.unmatched_payments || []).slice(0, 3).map((p: any) => p.invoice_number || p.invoice_id).join(', ')}
              {(reconcile.unmatched_payments || []).length > 3 ? '…' : ''}
            </div>
          )}
        </div>
      )}

      {/* Report bar */}
      <div className="card" style={{ marginBottom: 20, padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: 13 }}>Rapports PDF</strong>
          <select value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value)} style={{ width: 'auto' }}>
            <option value="month">Ce mois</option>
            <option value="3m">3 mois</option>
            <option value="6m">6 mois</option>
            <option value="9m">9 mois</option>
            <option value="12m">12 mois</option>
            <option value="24m">2 ans</option>
            <option value="36m">3 ans</option>
            <option value="48m">4 ans</option>
            <option value="year">Année civile</option>
          </select>
          <button className="secondary" style={{ fontSize: 13 }} onClick={() => openReport('/api/reports/balance', { period: reportPeriod })}>
            Solde & mouvements
          </button>
          <button className="secondary" style={{ fontSize: 13 }} onClick={() => openReport('/api/reports/stock')}>
            Stock
          </button>
          <button className="secondary" style={{ fontSize: 13 }} onClick={() => openReport('/api/reports/receivables')}>
            Créances
          </button>
          <button className="secondary" style={{ fontSize: 13 }} onClick={() => openReport('/api/reports/payables')}>
            Dettes
          </button>
          <button style={{ fontSize: 13 }} onClick={() => openReport('/api/reports/combined', { period: reportPeriod, sections: 'balance,stock,receivables,payables' })}>
            Tous les rapports
          </button>
          <button
            className="secondary"
            style={{ fontSize: 13 }}
            type="button"
            onClick={async () => {
              const name = await prompt({
                title: 'Situation client',
                message: 'Nom du client (ou partie du nom) pour le rapport PDF.',
                placeholder: 'Ex. haytam',
                confirmLabel: 'Ouvrir le rapport',
              });
              if (!name?.trim()) return;
              openReport('/api/reports/client-situation', { name: name.trim() });
            }}
          >
            Situation client
          </button>
          <button className="secondary" style={{ fontSize: 13 }} type="button" onClick={() => downloadExport('/api/export/expenses', 'solde-mouvements.csv')}>Excel CSV</button>
          <button className="secondary" style={{ fontSize: 13 }} type="button" onClick={() => downloadExport('/api/export/payments', 'paiements.csv')}>Paiements CSV</button>
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Ouvre une page → Imprimer / Enregistrer en PDF</span>
      </div>


      <div className="atlas-outline-row">
        <div className="atlas-outline-card">
          <div className="aoc-title">Caisse</div>
          <div className="aoc-lines">
            <span>Entrées <strong className="ok">+{fmt(stats.cashIn)}</strong></span>
            <span>Sorties <strong className="bad">−{fmt(stats.cashOut)}</strong></span>
            <span>Net <strong>{fmt(stats.cashIn - stats.cashOut)} {cur}</strong></span>
          </div>
        </div>
        <div className="atlas-outline-card">
          <div className="aoc-title">Banque</div>
          <div className="aoc-lines">
            <span>Entrées <strong className="ok">+{fmt(stats.bankIn)}</strong></span>
            <span>Sorties <strong className="bad">−{fmt(stats.bankOut)}</strong></span>
            <span>Net <strong>{fmt(stats.bankIn - stats.bankOut)} {cur}</strong></span>
          </div>
        </div>
        <div className="atlas-outline-card">
          <div className="aoc-title">Apports</div>
          <div className="aoc-value ok">+{fmt(stats.ownerContrib)} {cur}</div>
        </div>
        <div className="atlas-outline-card">
          <div className="aoc-title">Prélèvements</div>
          <div className="aoc-value bad">−{fmt(stats.ownerDraw)} {cur}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Filtrer :</span>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value as any)} style={{ width: 'auto' }}>
          <option value="all">Toutes les écritures</option>
          <option value="income">Recettes</option>
          <option value="expense">Dépenses</option>
          <option value="owner_contrib">Apports propriétaire</option>
          <option value="owner_draw">Prélèvements propriétaire</option>
        </select>
      </div>

      <div className="card">
        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.35rem', marginBottom: 16 }}>Mouvements</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Libellé</th><th>Catégorie</th><th>Mode</th>
                <th style={{ textAlign: 'right' }}>Montant</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{m.date}</td>
                  <td><span className={`badge ${TYPE_META[m.type]?.badge || 'info'}`}>{TYPE_META[m.type]?.label || m.type}</span></td>
                  <td><strong>{m.label}</strong></td>
                  <td><span className="badge info">{m.category}</span></td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{methodLabel(m.method)}</td>
                  <td className="bal-amount-cell">
                    <span
                      className={m.direction === 'in' ? 'bal-amount in' : 'bal-amount out'}
                      title={m.direction === 'in' ? 'Entrée' : 'Sortie'}
                    >
                      <span className="bal-sign">{m.direction === 'in' ? '+' : '−'}</span>
                      <span className="bal-num">{fmt(m.amount)}</span>
                      <span className="bal-cur">{cur}</span>
                    </span>
                  </td>
                  <td>
                    <button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => remove(m.id)}>Suppr.</button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7}>
                  <EmptyState
                    title="Aucun mouvement"
                    description="Ajoutez une recette, dépense, apport ou prélèvement pour alimenter le solde."
                    icon="wallet"
                  />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle écriture — {TYPE_META[entryType].label}</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              {TYPE_META[entryType].direction === 'in'
                ? 'Entrée de trésorerie (affichée en vert, signe +).'
                : 'Sortie de trésorerie (affichée en rouge, signe −).'}
            </p>
            <div className="form-row">
              <label>Type</label>
              <select
                value={entryType}
                onChange={(e) => {
                  const t = e.target.value as EntryType;
                  setEntryType(t);
                  setCategory(catsFor(t)[0]);
                }}
              >
                <option value="expense">Dépense</option>
                <option value="income">Recette</option>
                <option value="owner_contrib">Apport propriétaire</option>
                <option value="owner_draw">Prélèvement propriétaire</option>
              </select>
            </div>
            <div className="form-row">
              <label>Catégorie</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {catsFor(entryType).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Libellé *</label>
              <input className={fieldErrors.description ? 'field-error' : undefined} value={description} onChange={(e) => { setDescription(e.target.value); setFieldErrors((x) => ({ ...x, description: '' })); }} placeholder="Ex. Loyer entrepôt août" /><span className="field-error-msg">{fieldErrors.description || ''}</span>
            </div>
            <div className="grid grid-2">
              <div className="form-row">
                <label>Montant *</label>
                <NumberField value={amount} onValueChange={setAmount} step="0.01" min={0.01} />
              </div>
              <div className="form-row">
                <label>Date</label>
                <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-2">
              <div className="form-row">
                <label>Mode de paiement</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Espèces (caisse)</option>
                  <option value="bank">Banque / virement</option>
                  <option value="card">Carte</option>
                  <option value="check">Chèque</option>
                </select>
              </div>
              <div className="form-row">
                <label>Tiers / note</label>
                <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <label>Notes</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="form-actions">
              <button onClick={create} disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              <button className="secondary" onClick={() => setShowModal(false)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {pwOpen && pendingAction && (
        <PasswordConfirm
          open={pwOpen}
          title={pwTitle}
          description={pwDesc}
          confirmLabel="Confirmer la suppression"
          onCancel={() => { setPwOpen(false); setPendingAction(null); }}
          onConfirm={async (password) => { await pendingAction(password); }}
        />
      )}
    </div>
  );
}

function BankCsvReconcile() {
  const { toast } = useUi();
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [windowDays, setWindowDays] = useState(7);
  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const kindFr = (k: string) =>
    k === 'invoice_payment' ? 'Paiement client' :
    k === 'bill_payment' ? 'Paiement fournisseur' :
    k === 'expense' ? 'Mouvement solde' : k;

  const run = async () => {
    setBusy(true);
    try {
      const r: any = await api.reconcileBankCsv(csv, { date_window_days: windowDays });
      setResult(r.data);
      toast(r.message || 'Rapprochement terminé', 'success');
    } catch (e: any) {
      toast(e?.message || 'Échec', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Rapprochement banque (CSV)</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        Collez un extrait : <code>date;libellé;montant</code> (séparateur ; ou ,). 
        Matching intelligent : montant, date, n° facture/achat, sens crédit/débit.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 8 }}>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Fenêtre date (± jours)</label>
          <input
            type="number"
            min={0}
            max={60}
            value={windowDays}
            onChange={(e) => setWindowDays(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
            style={{ width: 80 }}
          />
        </div>
      </div>
      <textarea
        rows={5}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={'2026-08-01;Virement client FA-2026-0001;12000\n2026-08-02;Loyer;-3500'}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
      />
      <button type="button" disabled={busy || !csv.trim()} onClick={run} style={{ marginTop: 8 }}>
        {busy ? 'Analyse…' : 'Rapprocher'}
      </button>
      {result && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            Analysé : {result.parsed} · Matchés : <strong>{result.matched}</strong> · Sans match : {result.unmatched_count}
          </p>
          {result.rules && (
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
              Règles : {(result.rules as string[]).join(' · ')}
            </p>
          )}
          {result.matched > 0 && (
            <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto', marginBottom: 12 }}>
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Banque</th>
                    <th style={{ textAlign: "right" }}>Montant</th>
                    <th>Atlas</th>
                    <th>Score</th>
                    <th>Raisons</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.matches || []).slice(0, 40).map((m: any, i: number) => (
                    <tr key={i}>
                      <td>
                        {m.bank?.date} · {m.bank?.label?.slice(0, 40)}
                      </td>
                      <td style={{ fontWeight: 700 }}>{fmt(m.bank?.amount)}</td>
                      <td>
                        {kindFr(m.match?.kind)} #{m.match?.id}
                        {m.match?.ref ? ` · ${m.match.ref}` : ''}
                      </td>
                      <td>{m.score}</td>
                      <td style={{ color: 'var(--muted)' }}>{(m.reasons || []).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.unmatched_count > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                {result.unmatched_count} ligne(s) sans correspondance
              </summary>
              <ul style={{ fontSize: 12, marginTop: 6 }}>
                {(result.unmatched || []).slice(0, 30).map((u: any, i: number) => (
                  <li key={i}>
                    {u.date} · {u.label} · <strong>{fmt(u.amount)}</strong>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
