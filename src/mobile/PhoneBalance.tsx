import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Wallet, Plus, FileText, HandCoins, Receipt, CircleDollarSign } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import PhoneMonthlyReport from './PhoneMonthlyReport';
import PhoneReportBundle from './PhoneReportBundle';
import PhoneDialog from './PhoneDialog';
import PhoneSkeleton from './PhoneSkeleton';
import { financeMonths } from './phoneFinancePeriods';
import type { FinanceBucket, FinanceMonthly, FinancePeriod, FinanceRow, FinanceStatement } from './financeTypes';

type EntryKind = 'expense' | 'income' | 'owner_contrib' | 'owner_draw';
type Section = 'movements' | 'accounts' | 'reports';
const entryLabels: Record<EntryKind, string> = { expense: 'Dépense', income: 'Recette', owner_contrib: 'Apport', owner_draw: 'Prélèvement' };
const entryCategories: Record<EntryKind, string[]> = {
  expense: ['Fournitures de bureau', 'Équipement', 'Électronique', 'Loyer', 'Charges (eau, électricité, telecom)', 'Transport de marchandises', 'Transport personnel', 'Carburant', 'Marketing & publicité', 'Maintenance & réparations', 'Salaires & charges sociales', 'CNSS / AMO', 'TVA déductible', 'Impôt sur les sociétés (IS)', 'Impôt sur le revenu (IR)', 'Taxe professionnelle', 'Droits de douane', 'Honoraires (expert-comptable, avocat)', 'Assurances', 'Matière première', 'Emballage & logistique', 'Formation', 'Autre charge déductible'],
  income: ['Vente divers', 'Prestation de service', 'Remboursement', 'Subvention', 'Intérêts', 'Autre recette'],
  owner_contrib: ['Apport en capital', 'Apport en compte courant', 'Autre apport'],
  owner_draw: ['Prélèvement personnel', 'Dividende', 'Remboursement associé', 'Autre prélèvement'],
};
const money = (value: number, currency: string) => `${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function AmountCard({ label, value, currency, tone = '' }: { label: string; value: number; currency: string; tone?: string }) {
  return <div className={`pb-card pb-amount ${tone}`}><span>{label}</span><strong>{money(value, currency)}</strong></div>;
}
function Bucket({ title, bucket, currency }: { title: string; bucket: FinanceBucket; currency: string }) {
  return <section className="pb-card pb-bucket"><h3>{title}</h3><strong>{money(bucket.total_outstanding, currency)}</strong><p>{bucket.count} document(s) · En retard : {money(bucket.total_overdue, currency)}</p>
    {bucket.documents.length ? bucket.documents.map((d) => <div className="pb-document" key={d.id}><div><strong>{d.party || '—'}</strong><small>{d.number} {d.due_date ? `· Échéance ${d.due_date}` : ''}</small></div><b>{money(d.remaining, currency)}</b></div>) : <p>Aucun document ouvert pour cette période.</p>}
    {bucket.truncated && <p>Liste partielle : le serveur limite les documents affichés.</p>}
  </section>;
}


type EntryPayload = { entry_type: EntryKind; category: string; description: string; amount: number; payment_method: string; expense_date: string; vendor_name: string; notes: string };
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function EntryDialog({ initialKind, saving, error, onClose, onSave }: { initialKind: EntryKind; saving: boolean; error: string; onClose: () => void; onSave: (entry: EntryPayload) => void }) {
  const [kind, setKind] = useState(initialKind); const [step, setStep] = useState(0);
  const [category, setCategory] = useState(entryCategories[initialKind][0]); const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(''); const [date, setDate] = useState(today()); const [method, setMethod] = useState('cash');
  const [vendor, setVendor] = useState(''); const [notes, setNotes] = useState('');
  const parsed = Number(amount.trim().replace(',', '.'));
  const canSave = description.trim().length > 0 && amount.trim() !== '' && Number.isFinite(parsed) && parsed >= 0.01 && parsed <= 1e12 && validDate(date);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (step === 0) { if (description.trim()) setStep(1); return; }
    if (canSave) onSave({ entry_type: kind, category, description: description.trim(), amount: parsed, payment_method: method, expense_date: date, vendor_name: vendor.trim(), notes: notes.trim() });
  };
  return <PhoneDialog titleId="pb-entry-title" className="pb-entry-modal" onClose={() => { if (!saving) onClose(); }}><form className="pb-form pb-entry-form" onSubmit={submit}>
    <h2 id="pb-entry-title">Nouvelle écriture — {entryLabels[kind]}</h2><div className="pb-entry-body">
      <p className="pb-entry-step">{step === 0 ? 'Étape 1/2 · Type et libellé' : 'Étape 2/2 · Montant et règlement'}</p>
      {step === 0 ? <><label>Type<select name="kind" value={kind} onChange={e => { const next = e.target.value as EntryKind; setKind(next); setCategory(entryCategories[next][0]); }}>{(Object.keys(entryLabels) as EntryKind[]).map(k => <option key={k} value={k}>{entryLabels[k]}</option>)}</select></label>
        <label>Catégorie<select name="category" value={category} onChange={e => setCategory(e.target.value)}>{entryCategories[kind].map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Libellé *<input name="description" value={description} maxLength={255} placeholder="Ex. Loyer entrepôt octobre" onChange={e => setDescription(e.target.value)} /></label>
        {!description.trim() && <p className="pb-entry-help">La description est obligatoire.</p>}</> : <>
        <label>Montant *<input name="amount" type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label>Date<input name="date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Mode de paiement<select name="method" value={method} onChange={e => setMethod(e.target.value)}><option value="cash">Espèces (caisse)</option><option value="bank">Banque / virement</option><option value="card">Carte</option><option value="check">Chèque</option></select></label>
        <label>Bénéficiaire / fournisseur (facultatif)<input name="vendor" value={vendor} onChange={e => setVendor(e.target.value)} /></label><label>Notes (facultatif)<textarea name="notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {(!Number.isFinite(parsed) || parsed < 0.01 || parsed > 1e12 || !amount.trim()) && <p className="pb-entry-help">Saisissez un montant entre 0,01 et 1 000 000 000 000.</p>}{!validDate(date) && <p className="pb-entry-help">La date doit être valide.</p>}
      </>}{error && <p className="pb-entry-help" role="alert">{error}</p>}
    </div><div className="pb-form-actions"><button className="theme-toggle pb-entry-cancel" type="button" disabled={saving} onClick={onClose}>Annuler</button>{step === 1 && <button className="theme-toggle pb-entry-back" type="button" disabled={saving} onClick={() => setStep(0)}>Retour</button>}<button className="theme-toggle pb-entry-primary" type="submit" disabled={saving || (step === 0 ? !description.trim() : !canSave)}>{saving ? 'Enregistrement…' : step === 0 ? 'Continuer' : 'Enregistrer'}</button></div>
  </form></PhoneDialog>;
}

export default function PhoneBalance() {
  const [period, setPeriod] = useState('');
  const [monthChoices, setMonthChoices] = useState<{ value: string; label: string }[]>([]);
  const [finance, setFinance] = useState<FinanceMonthly | null>(null);
  const [breakdown, setBreakdown] = useState<FinancePeriod | null>(null);
  const [statement, setStatement] = useState<FinanceStatement | null>(null);
  const [rows, setRows] = useState<FinanceRow[]>([]);
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState<Section>(() => searchParams.get('tab') === 'reports' ? 'reports' : 'movements');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [breakdownError, setBreakdownError] = useState(false);
  const [entry, setEntry] = useState<EntryKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [notice, setNotice] = useState('');
  const [reportPeriod, setReportPeriod] = useState<string | null>(null);
  const [bundleOpen, setBundleOpen] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current;
    setLoading(true); setError(''); setBreakdownError(false); setFinance(null); setStatement(null); setBreakdown(null); setRows([]); setLoadingMore(false);
    (async () => {
      try {
        const result = await api.getFinanceMonthly(period || undefined);
        if (id !== generation.current) return;
        const data = result.data;
        setFinance(data);
        setMonthChoices((old) => old.length ? old : financeMonths(data.period));
        const [stmt, detail] = await Promise.allSettled([api.getFinanceStatement(data.period), api.getFinancePeriod(data.period)]);
        if (id !== generation.current) return;
        if (stmt.status === 'fulfilled') { setStatement(stmt.value.data); setRows(stmt.value.data.rows); }
        else setError('Relevé indisponible. Réessayez.');
        if (detail.status === 'fulfilled') setBreakdown(detail.value.data);
        else setBreakdownError(true);
      } catch { if (id === generation.current) setError('Impossible de charger les données financières. Vérifiez votre connexion puis réessayez.'); }
      finally { if (id === generation.current) setLoading(false); }
    })();
    return () => { generation.current++; };
  }, [period, reload]);
  const refresh = () => setReload((n) => n + 1);
  const loadMore = async () => {
    if (!statement || !finance || loadingMore || !statement.has_more) return;
    const id = generation.current;
    setLoadingMore(true);
    try {
      const next = (await api.getFinanceStatement(finance.period, statement.page + 1)).data;
      if (id === generation.current) { setRows((old) => [...old, ...next.rows]); setStatement(next); }
    } catch { if (id === generation.current) setError('Impossible de charger la suite du relevé.'); }
    finally { if (id === generation.current) setLoadingMore(false); }
  };
  const savingRef = useRef(false);
  const saveEntry = async (payload: EntryPayload) => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setEntryError('');
    try {
      await api.createExpense(payload);
      setEntry(null); setNotice('Écriture enregistrée dans la balance.'); refresh();
    } catch (e) { setEntryError(e instanceof Error ? e.message : 'Enregistrement impossible.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const currency = finance?.currency || 'MAD';
  const visibleRows = rows.filter((row) => {
    if (filter === 'in' && !(row.credit > 0)) return false;
    if (filter === 'out' && !(row.debit > 0)) return false;
    if (filter === 'expense' && row.type.toLowerCase() !== 'expense') return false;
    return [row.label, row.ref, row.type, row.ts].some((text) => String(text || '').toLowerCase().includes(query.trim().toLowerCase()));
  });
  return <div className="pb-page">
    <p className="pb-subtitle">Trésorerie · créances · mouvements</p>
    <div className="pb-period"><label><span className="pb-sr">Choisir un mois</span><select aria-label="Choisir un mois" value={period || finance?.period || ''} disabled={!finance && !monthChoices.length} onChange={(e) => setPeriod(e.target.value)}>
      {!finance && !period && <option value="">Mois</option>}{monthChoices.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
    </select></label><button className="pb-refresh theme-toggle" type="button" aria-label="Actualiser les soldes" disabled={loading} onClick={refresh}><RefreshCw size={19} /></button></div>
    <div className="pb-actions" aria-label="Nouvelle écriture">{(Object.keys(entryLabels) as EntryKind[]).map((kind) => { const Icon = kind === 'expense' ? Plus : kind === 'income' ? CircleDollarSign : HandCoins; return <button className="theme-toggle" type="button" key={kind} onClick={() => { setEntryError(''); setEntry(kind); }}><Icon size={18} aria-hidden="true" /><span>{kind === 'expense' ? '+ Dépense' : entryLabels[kind]}</span></button>; })}</div>
    <div className="pb-tabs" role="tablist" aria-label="Sections balance">{([['movements', 'Mouvements'], ['accounts', 'Comptes'], ['reports', 'Rapports']] as const).map(([id, label]) => <button className="theme-toggle" key={id} role="tab" type="button" aria-selected={section === id} tabIndex={section === id ? 0 : -1} onClick={() => setSection(id)} onKeyDown={(event) => {
      const ids: Section[] = ['movements', 'accounts', 'reports'];
      const current = ids.indexOf(id);
      const next = event.key === 'ArrowRight' ? (current + 1) % ids.length : event.key === 'ArrowLeft' ? (current + ids.length - 1) % ids.length : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); setSection(ids[next]); (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus(); }
    }}>{label}</button>)}</div>
    {notice && <p className="pb-notice" role="status">{notice}</p>}
    {error && <div className="pb-notice" role="alert">{error} <button className="theme-toggle" type="button" onClick={refresh}>Réessayer</button></div>}
    {loading && <PhoneSkeleton variant="dashboard" label="Chargement des données financières" />}
    {!loading && finance && <>
      {section === 'movements' && <div className="pb-section">
        {breakdown ? <div className="pb-grid"><div className="pb-card"><h3>Caisse</h3><p>Entrées <b>{money(breakdown.inflows.cash, currency)}</b></p><p>Sorties <b>{money(breakdown.outflows.cash, currency)}</b></p></div><div className="pb-card"><h3>Banque</h3><p>Entrées <b>{money(breakdown.inflows.bank, currency)}</b></p><p>Sorties <b>{money(breakdown.outflows.bank, currency)}</b></p></div><AmountCard label="Apports" value={breakdown.owner.contributions.total} currency={currency} tone="in" /><AmountCard label="Prélèvements" value={breakdown.owner.withdrawals.total} currency={currency} tone="out" /></div> : breakdownError && <p className="pb-note">Ventilation caisse/banque indisponible ; les soldes détaillés ne sont pas estimés.</p>}
        {breakdown && breakdown.outflows.not_recorded > 0 && <p className="pb-note">Mode de paiement non enregistré : {money(breakdown.outflows.not_recorded, currency)}, non attribué à la caisse ni à la banque.</p>}
        <div className="pb-card pb-closing"><span><Wallet size={18} /> SOLDE DE CLÔTURE</span><strong>{money(finance.closing_balance, currency)}</strong><small>Après les mouvements comptabilisés</small></div>
        <div className="pb-grid"><AmountCard label="Ouverture" value={finance.opening_balance} currency={currency} /><AmountCard label="Entrées de ventes" value={finance.sales_received} currency={currency} tone="in" /></div>
        <AmountCard label="Sorties payées" value={finance.expenses + finance.payroll_paid + finance.supplier_paid} currency={currency} tone="out" />
        {breakdown && <div className="pb-card"><h3>Dépenses par catégorie</h3>{breakdown.expense_categories.length ? breakdown.expense_categories.map((c) => <p key={c.category}>{c.category} <b>{money(c.total, currency)}</b></p>) : <p>Aucune dépense</p>}{breakdown.categories_truncated && <small>Liste partielle</small>}</div>}
        {statement && <><div className="pb-card"><h3>Entrées et sorties</h3><p>Entrées <b>{money(statement.totals.credits, currency)}</b></p><p>Sorties <b>{money(statement.totals.debits, currency)}</b></p><small>{statement.reconciliation.balanced ? 'Relevé équilibré' : 'Écart détecté dans le relevé'}{breakdown && !breakdown.statement.consistent_with_breakdown ? ' · La ventilation diffère du relevé' : ''}</small></div>
          <div className="pb-card pb-movements"><h3>Transactions récentes</h3><p>{statement.total} mouvement(s) · filtrage des lignes chargées</p><label>Filtrer<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Toutes les écritures</option><option value="in">Entrées</option><option value="out">Sorties</option><option value="expense">Dépenses</option></select></label><label>Rechercher<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Libellé, référence…" /></label>
            {visibleRows.map((r, i) => <div className="pb-row" key={`${r.source}-${r.id}-${i}`}><span className="pb-row-icon">{r.credit > 0 ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span><div><strong>{r.label || r.type}</strong><small>{r.ref} {r.ts ? `· ${r.ts.slice(0, 10)}` : ''}</small></div><b className={r.credit > 0 ? 'in' : 'out'}>{r.credit > 0 ? '+' : '−'}{money(r.credit > 0 ? r.credit : r.debit, currency)}</b></div>)}
            {!visibleRows.length && <p>Aucun mouvement parmi les lignes chargées.</p>}{statement.has_more && <button className="theme-toggle" type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Chargement…' : 'Charger plus'}</button>}
          </div></>}
      </div>}
      {section === 'accounts' && <div className="pb-section"><Bucket title="À recevoir" bucket={finance.receivables} currency={currency} /><Bucket title="À payer" bucket={finance.payables} currency={currency} /><AmountCard label={`Paie encore due · ${finance.payroll.employees} employé(s)`} value={finance.payroll.total_due} currency={currency} /></div>}
      {section === 'reports' && <div className="pb-section"><div className="pb-card"><h3><FileText size={18} aria-hidden="true" /> Rapports financiers</h3><p>Relevé mensuel officiel du serveur · {finance.period}</p><button className="theme-toggle" type="button" onClick={() => setReportPeriod(finance.period)}>Télécharger et lire le PDF</button></div><div className="pb-card"><h3><Receipt size={18} aria-hidden="true" /> Pack de rapports personnalisable</h3><p>Choisissez la période et les rubriques à consulter.</p><button className="theme-toggle" type="button" onClick={() => setBundleOpen(true)}>Ouvrir dans Atlas</button></div><Link to="/m/balance/classic">Ouvrir la balance web complète</Link></div>}
    </>}
    {reportPeriod && <PhoneMonthlyReport period={reportPeriod} onClose={() => setReportPeriod(null)} />}
    {bundleOpen && <PhoneReportBundle onClose={() => setBundleOpen(false)} />}
    {entry && <EntryDialog key={entry} initialKind={entry} saving={saving} error={entryError} onClose={() => setEntry(null)} onSave={saveEntry} />}
  </div>;
}
