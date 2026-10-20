import { suggestExpenseCategory } from '../lib/assist';
import DatePicker from '../components/DatePicker';
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
import { FloatingPortal } from '../components/FloatingPortal';
import { ModalFormError, FieldHint } from '../components/ModalFormFeedback';
import { ListPager } from '../components/ui/ListPager';
import { TimedUndoDelete } from '../components/ui/TimedUndoDelete';
import {
  Banknote, ShoppingBag, Truck, Fuel, Building2, Wrench, Users, Receipt,
  ArrowDownLeft, ArrowUpRight, Wallet, Package,
} from 'lucide-react';

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


function BalanceMiniBars({ title, rows }: { title: string; rows: { label: string; value: number; tone?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="ac-panel balance-chart-card balance-page">
      <h3 className="balance-chart-title">{title}</h3>
      <div className="balance-chart-bars">
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Aucune donnée</p>
        ) : (
          rows.map((r) => (
            <div key={r.label} className="balance-chart-row">
              <span className="balance-chart-label" title={r.label}>{r.label}</span>
              <div className="balance-chart-track">
                <div
                  className="balance-chart-fill"
                  style={{
                    width: `${Math.min(100, (Math.abs(r.value) / max) * 100)}%`,
                    background: r.tone || '#0f172a',
                  }}
                />
              </div>
              <span className="balance-chart-val">{Math.round(r.value).toLocaleString('fr-FR')}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

type EntryType = 'expense' | 'income' | 'owner_draw' | 'owner_contrib';

const TYPE_META: Record<EntryType, { label: string; direction: 'in' | 'out'; badge: string }> = {
  expense: { label: 'Dépense', direction: 'out', badge: 'danger' },
  income: { label: 'Recette', direction: 'in', badge: 'success' },
  owner_draw: { label: 'Prélèvement propriétaire', direction: 'out', badge: 'warning' },
  owner_contrib: { label: 'Apport propriétaire', direction: 'in', badge: 'info' },
};


function txIcon(type: EntryType, category?: string) {
  const c = (category || '').toLowerCase();
  if (type === 'income' || type === 'owner_contrib') return ArrowDownLeft;
  if (type === 'owner_draw') return ArrowUpRight;
  if (/carburant|fuel|essence/.test(c)) return Fuel;
  if (/transport|livraison/.test(c)) return Truck;
  if (/loyer|local|entrepôt|entrepot/.test(c)) return Building2;
  if (/salaire|cnss|personnel/.test(c)) return Users;
  if (/maintenance|réparation|reparation/.test(c)) return Wrench;
  if (/fourniture|équipement|electron|électr|matière|matiere/.test(c)) return Package;
  if (/taxe|impôt|impot|tva|douane/.test(c)) return Receipt;
  if (/marketing|publicit/.test(c)) return ShoppingBag;
  return Wallet;
}

function formatTxDate(d: string) {
  if (!d) return '—';
  try {
    const dt = new Date(d.length === 10 ? d + 'T12:00:00' : d);
    if (Number.isNaN(dt.getTime())) return d;
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startY = new Date(startToday); startY.setDate(startY.getDate() - 1);
    if (dt >= startToday) return `Aujourd'hui`;
    if (dt >= startY) return 'Hier';
    return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch {
    return d;
  }
}

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
  const [modalError, setModalError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [txPage, setTxPage] = useState(0);
  const [txQuery, setTxQuery] = useState('');
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
    setModalError(''); setShowModal(true);
  };

  const create = async () => {
    const fe = validateBalanceEntry({ description, amount }); setFieldErrors(fe); if (Object.keys(fe).length) { setModalError(firstError(fe) || 'Complétez l’écriture.'); return; } setModalError('');
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
    } catch (e: any) { setModalError(e?.message || 'Enregistrement impossible'); } finally { setSaving(false); }
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
      if (filterType !== 'all' && filterType !== t) return false;
      if (txQuery.trim()) {
        const q = txQuery.trim().toLowerCase();
        const hay = `${e.label || ''} ${e.category || ''} ${e.type || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
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

  const TX_PAGE = 50;
  const sortedRows = rows;
  const pagedRows = sortedRows.slice(txPage * TX_PAGE, txPage * TX_PAGE + TX_PAGE);

  const byCategoryChart = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      const tpe = (e as any).entry_type || 'expense';
      if (tpe !== 'expense' && tpe !== 'owner_draw') continue;
      const cat = String((e as any).category || 'Autre');
      map.set(cat, (map.get(cat) || 0) + Number((e as any).amount || 0));
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value, tone: '#0f172a' }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [expenses]);

  const byTypeChart = useMemo(() => {
    const map: Record<string, number> = { expense: 0, income: 0, owner_draw: 0, owner_contrib: 0 };
    for (const e of expenses) {
      const tpe = ((e as any).entry_type || 'expense') as string;
      if (map[tpe] !== undefined) map[tpe] += Number((e as any).amount || 0);
    }
    return [
      { label: 'Dépenses', value: map.expense, tone: '#ef4444' },
      { label: 'Recettes', value: map.income, tone: '#2563eb' },
      { label: 'Prélèvements', value: map.owner_draw, tone: '#f59e0b' },
      { label: 'Apports', value: map.owner_contrib, tone: '#0f172a' },
    ];
  }, [expenses]);

  if (loading)
    return (
      <div className="atlas-page balance-page">
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
    <div className="atlas-page balance-page">
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

      <div className="ac-metric-grid">
        <div className="ac-metric">
          <div className="as-label">Solde actuel</div>
          <div className="as-value" style={{ fontSize: '1.15rem' }}>
            {balance.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} MAD
          </div>
          <div className="as-hint">caisse &amp; banque</div>
        </div>
        <div className="ac-metric">
          <div className="as-label">Entrées</div>
          <div className="as-value" style={{ fontSize: '1.15rem' }}>
            {moneyIn.toLocaleString('fr-FR', { minimumFractionDigits: 0 })} MAD
          </div>
          <div className="as-hint">ventes + recettes + apports</div>
        </div>
        <div className="ac-metric">
          <div className="as-label">Sorties</div>
          <div className="as-value" style={{ fontSize: '1.15rem' }}>
            {moneyOut.toLocaleString('fr-FR', { minimumFractionDigits: 0 })} MAD
          </div>
          <div className="as-hint">achats + dépenses + prélèvements</div>
        </div>
        <div className="ac-metric">
          <div className="as-label">Flux net</div>
          <div className="as-value" style={{ fontSize: '1.15rem' }}>
            {(moneyIn - moneyOut).toLocaleString('fr-FR', { minimumFractionDigits: 0 })} MAD
          </div>
          <div className="as-hint">entrées − sorties</div>
        </div>
      </div>

      <div className="balance-charts-grid">
        <BalanceMiniBars title="Sorties par catégorie" rows={byCategoryChart} />
        <BalanceMiniBars title="Répartition par type" rows={byTypeChart} />
      </div>
      <div className="balance-charts-grid" style={{ marginTop: 12 }}>
        <BalanceMiniBars
          title="Entrées (recettes + apports)"
          rows={byTypeChart.filter((r) => r.label === 'Recettes' || r.label === 'Apports')}
        />
        <BalanceMiniBars
          title="Sorties (dépenses + prélèvements)"
          rows={byTypeChart.filter((r) => r.label === 'Dépenses' || r.label === 'Prélèvements')}
        />
      </div>

      {reconcile && (
        <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
          <div
            className="balance-reconcile-head"
            style={{
              padding: '14px 18px',
              background: reconcile.summary?.ok ? '#ffffff' : 'rgba(239, 68, 68, 0.06)',
              borderBottom: '1px solid #e8eaef',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div>
              <strong style={{ fontSize: 15, color: '#0f172a' }}>Rapprochement comptable</strong>
              <p
                style={{
                  fontSize: 13,
                  margin: '4px 0 0',
                  color: reconcile.summary?.ok ? '#71717a' : '#b91c1c',
                }}
              >
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
          <button className="secondary" style={{ fontSize: 13 }} onClick={() => openReport('/api/reports/employees')}>
            Employés &amp; paie
          </button>
          <button style={{ fontSize: 13 }} onClick={() => openReport('/api/reports/combined', { period: reportPeriod, sections: 'balance,stock,receivables,payables,employees' })}>
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

<div className="card bal-tx-card">
        <div className="bal-tx-toolbar">
          <div className="bal-tx-toolbar-left">
            <label className="bal-tx-filter-label">
              <span>Filtrer</span>
              <select
                value={filterType}
                onChange={(e) => { setFilterType(e.target.value as any); setTxPage(0); }}
              >
                <option value="all">Toutes les écritures</option>
                <option value="income">Recettes</option>
                <option value="expense">Dépenses</option>
                <option value="capital">Apports</option>
                <option value="owner_draw">Prélèvements</option>
                <option value="transfer">Virements</option>
              </select>
            </label>
            <input
              type="search"
              className="bal-tx-search"
              placeholder="Rechercher…"
              value={txQuery}
              onChange={(e) => { setTxQuery(e.target.value); setTxPage(0); }}
            />
          </div>
          <ListPager
            page={txPage}
            pageSize={50}
            total={sortedRows.length}
            onPageChange={setTxPage}
            pageBase={0}
            className="bal-tx-pager"
          />
        </div>
        <div className="bal-tx-head-title">
          <h2 className="bal-tx-title">Transactions récentes</h2>
          <p className="bal-tx-sub">Derniers mouvements de trésorerie (50 par page)</p>
        </div>
        <div className="bal-tx-list">
          {pagedRows.map((m: any) => {
            const meta = TYPE_META[m.type as EntryType] || TYPE_META.expense;
            const Icon = txIcon((m.type as EntryType) || 'expense', m.category);
            const isIn = m.direction === 'in' || meta.direction === 'in';
            return (
              <div key={m.id} className="bal-tx-row">
                <div className={`bal-tx-icon${isIn ? ' is-in' : ' is-out'}`}>
                  <Icon size={18} strokeWidth={2} />
                </div>
                <div className="bal-tx-main">
                  <div className="bal-tx-name">{m.label || meta.label}</div>
                  <div className="bal-tx-cat">{m.category || meta.label}</div>
                </div>
                <div className="bal-tx-date">{formatTxDate(m.date)}</div>
                <div className={`bal-tx-amount${isIn ? ' is-in' : ' is-out'}`}>
                  {isIn ? '+' : '−'}{fmt(m.amount)} {cur}
                </div>
                <div className="bal-tx-actions">
                  <TimedUndoDelete
                    deleteLabel="Supprimer"
                    undoLabel="Annuler"
                    initialSeconds={10}
                    onConfirm={() => remove(m.id)}
                  />
                </div>
              </div>
            );
          })}
          {!sortedRows.length && (
            <div className="bal-tx-empty">
              <EmptyState
                title="Aucun mouvement"
                description="Ajoutez une recette, dépense, apport ou prélèvement pour alimenter le solde."
                icon="wallet"
              />
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <FloatingPortal><div className="modal-overlay" onClick={() => setShowModal(false)}>
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
                <DatePicker value={expenseDate} onChange={setExpenseDate} />
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
            <ModalFormError message={modalError} />
            <div className="form-actions">
              <button onClick={create} disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              <button className="secondary" onClick={() => setShowModal(false)}>Annuler</button>
            </div>
          </div>
        </div></FloatingPortal>
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
