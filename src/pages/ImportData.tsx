import { useState } from 'react';
import { api } from '../api';
import SaveFeedback from '../components/SaveFeedback';

type PreviewRow = {
  date: string;
  description: string;
  amount: number;
  entry_type: 'income' | 'expense' | 'owner_draw' | 'owner_contrib';
  category: string;
  payment_method: string;
  selected: boolean;
};

type BillPreview = {
  vendor_name: string;
  number: string;
  issue_date: string;
  total: number;
  description: string;
  selected: boolean;
};

type ClientPreview = {
  row: number;
  name: string;
  ice: string;
  if_number: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  valid: boolean;
  warning?: boolean;
  errors: string[];
  duplicate: null | { id: number; name: string; ice?: string; email?: string; match_on: string };
  action: 'create' | 'update' | 'skip';
  selected: boolean;
};

const CLIENT_FIELDS = [
  { key: 'name', label: 'Nom *', aliases: ['name', 'nom', 'raison', 'client', 'company', 'societe', 'société'] },
  { key: 'ice', label: 'ICE', aliases: ['ice', 'identifiant commun'] },
  { key: 'if_number', label: 'IF', aliases: ['if', 'if_number', 'identifiant fiscal', 'idf'] },
  { key: 'address', label: 'Adresse', aliases: ['address', 'adresse', 'addr'] },
  { key: 'city', label: 'Ville', aliases: ['city', 'ville'] },
  { key: 'phone', label: 'Téléphone', aliases: ['phone', 'tel', 'téléphone', 'telephone', 'mobile'] },
  { key: 'email', label: 'E-mail', aliases: ['email', 'mail', 'e-mail', 'courriel'] },
] as const;

function parseCsv(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if ((ch === ',' || ch === ';' || ch === '\t') && !inQ) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

function autoMapHeaders(header: string[]): Record<string, number> {
  const h = header.map((x) => x.toLowerCase().trim());
  const map: Record<string, number> = {};
  for (const f of CLIENT_FIELDS) {
    let idx = -1;
    for (const alias of f.aliases) {
      idx = h.findIndex((cell) => cell === alias || cell.includes(alias));
      if (idx >= 0) break;
    }
    map[f.key] = idx;
  }
  return map;
}

function mapLedgerRows(table: string[][]): PreviewRow[] {
  if (!table.length) return [];
  const header = table[0].map((h) => h.toLowerCase());
  const find = (...keys: string[]) => {
    for (const k of keys) {
      const i = header.findIndex((h) => h.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = find('date', 'تاريخ', 'التاريخ');
  const iDesc = find('desc', 'libell', 'info', 'معلومات', 'label', 'designation');
  const iOut = find('sortie', 'خروج', 'out', 'debit');
  const iIn = find('entrée', 'entree', 'دخول', 'in', 'credit');
  const iAmt = find('montant', 'amount', 'prix');
  const rows: PreviewRow[] = [];
  for (const cells of table.slice(1)) {
    if (cells.every((c) => !c)) continue;
    const date = (iDate >= 0 ? cells[iDate] : '') || new Date().toISOString().slice(0, 10);
    const description = (iDesc >= 0 ? cells[iDesc] : cells[0]) || 'Import';
    const outV = iOut >= 0 ? Number(String(cells[iOut]).replace(/[^\d.-]/g, '')) : 0;
    const inV = iIn >= 0 ? Number(String(cells[iIn]).replace(/[^\d.-]/g, '')) : 0;
    let amount = iAmt >= 0 ? Number(String(cells[iAmt]).replace(/[^\d.-]/g, '')) : 0;
    let entry_type: PreviewRow['entry_type'] = 'expense';
    if (inV > 0) { amount = inV; entry_type = 'income'; }
    else if (outV > 0) { amount = outV; entry_type = 'expense'; }
    if (!amount || amount <= 0) continue;
    rows.push({
      date: String(date).slice(0, 10),
      description,
      amount,
      entry_type,
      category: entry_type === 'income' ? 'Import recette' : 'Import dépense',
      payment_method: 'cash',
      selected: true,
    });
  }
  return rows;
}

export default function ImportData() {
  const [mode, setMode] = useState<'ledger' | 'bills' | 'clients'>('clients');
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [billPreview, setBillPreview] = useState<BillPreview[]>([]);
  const [clientPreview, setClientPreview] = useState<ClientPreview[]>([]);
  const [clientStats, setClientStats] = useState<any>(null);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, number>>({});
  const [rawTable, setRawTable] = useState<string[][]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 5000);
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const table = parseCsv(text);
    if (table.length < 2) { flash('Fichier vide ou sans données.', 'error'); return; }
    setRawTable(table);

    if (mode === 'ledger') {
      const rows = mapLedgerRows(table);
      setPreview(rows); setBillPreview([]); setClientPreview([]);
      flash(rows.length ? `${rows.length} ligne(s) solde à valider` : 'Aucune ligne reconnue', rows.length ? 'success' : 'error');
    } else if (mode === 'bills') {
      const header = table[0].map((h) => h.toLowerCase());
      const idx = (keys: string[]) => {
        for (const k of keys) {
          const i = header.findIndex((h) => h.includes(k));
          if (i >= 0) return i;
        }
        return -1;
      };
      const iVen = idx(['vendor', 'fournisseur', 'supplier', 'nom']);
      const iNum = idx(['number', 'numero', 'n°', 'ref']);
      const iDate = idx(['date']);
      const iTot = idx(['total', 'montant', 'amount']);
      const iDesc = idx(['desc', 'libell', 'designation']);
      const rows: BillPreview[] = [];
      for (const cells of table.slice(1)) {
        const total = Number(String(cells[iTot >= 0 ? iTot : cells.length - 1] || '').replace(/[^\d.-]/g, ''));
        if (!total) continue;
        rows.push({
          vendor_name: cells[iVen >= 0 ? iVen : 0] || 'Fournisseur',
          number: cells[iNum >= 0 ? iNum : 1] || '',
          issue_date: String(cells[iDate >= 0 ? iDate : 2] || new Date().toISOString().slice(0, 10)).slice(0, 10),
          total,
          description: cells[iDesc >= 0 ? iDesc : 0] || 'Import facture fournisseur',
          selected: true,
        });
      }
      setBillPreview(rows); setPreview([]); setClientPreview([]);
      flash(rows.length ? `${rows.length} facture(s) fournisseur à valider` : 'Aucune ligne', rows.length ? 'success' : 'error');
    } else {
      const headers = table[0];
      setRawHeaders(headers);
      setColumnMap(autoMapHeaders(headers));
      setPreview([]); setBillPreview([]); setClientPreview([]); setClientStats(null);
      flash('Fichier chargé. Vérifiez le mapping des colonnes puis lancez l\'analyse.', 'success');
    }
  };

  const buildClientRowsFromMap = (): any[] => {
    if (!rawTable.length) return [];
    return rawTable.slice(1).map((cells) => {
      const get = (key: string) => {
        const i = columnMap[key];
        return i >= 0 && i < cells.length ? cells[i] : '';
      };
      return {
        name: get('name'), ice: get('ice'), if_number: get('if_number'),
        address: get('address'), city: get('city'), phone: get('phone'), email: get('email'),
      };
    }).filter((r) => Object.values(r).some((v) => String(v).trim()));
  };

  const analyzeClients = async () => {
    const rows = buildClientRowsFromMap();
    if (!rows.length) { flash('Aucune ligne à analyser. Vérifiez le mapping (colonne Nom).', 'error'); return; }
    setSaving(true);
    try {
      const res = await api.importClientsPreview(rows);
      const list = (res.data.rows || []).map((r: any) => ({
        ...r, selected: r.valid, action: r.duplicate ? 'skip' : 'create',
      }));
      setClientPreview(list);
      setClientStats(res.data.stats);
      flash(`Analyse : ${res.data.stats.valid} valide(s), ${res.data.stats.duplicates} doublon(s), ${res.data.stats.invalid} invalide(s).`);
    } catch (e: any) { flash(e.message || 'Erreur analyse', 'error'); }
    finally { setSaving(false); }
  };

  const importLedger = async () => {
    const rows = preview.filter((r) => r.selected);
    if (!rows.length) { flash('Aucune ligne sélectionnée', 'error'); return; }
    setSaving(true);
    try {
      const res: any = await api.importExpenses(rows.map((r) => ({
        date: r.date, description: r.description, amount: r.amount,
        entry_type: r.entry_type, category: r.category, payment_method: r.payment_method,
      })));
      flash(res.message || 'Import terminé'); setPreview([]);
    } catch (e: any) { flash(e.message || 'Erreur import', 'error'); }
    finally { setSaving(false); }
  };

  const importBills = async () => {
    const rows = billPreview.filter((r) => r.selected);
    if (!rows.length) { flash('Aucune ligne sélectionnée', 'error'); return; }
    setSaving(true);
    let ok = 0;
    try {
      for (const r of rows) {
        await api.createBill({
          vendor_name: r.vendor_name, number: r.number || undefined, issue_date: r.issue_date,
          status: 'sent', notes: 'Import CSV',
          items: [{ product_name: r.description, quantity: 1, unit_cost: r.total, tax_rate: 0 }],
        });
        ok++;
      }
      flash(`${ok} facture(s) d'achat créée(s).`); setBillPreview([]);
    } catch (e: any) { flash(e.message || `Import partiel (${ok})`, 'error'); }
    finally { setSaving(false); }
  };

  const importClients = async () => {
    const rows = clientPreview.filter((r) => r.selected && r.valid);
    if (!rows.length) { flash('Aucune ligne valide sélectionnée.', 'error'); return; }
    setSaving(true);
    try {
      const payload = rows.map((r) => ({
        name: r.name, ice: r.ice, if_number: r.if_number, address: r.address,
        city: r.city, phone: r.phone, email: r.email, action: r.action, duplicate_id: r.duplicate?.id,
      }));
      const res: any = await api.importClients(payload);
      flash(res.message || 'Import clients terminé.');
      setClientPreview([]); setClientStats(null); setRawTable([]); setRawHeaders([]);
    } catch (e: any) { flash(e.message || 'Erreur import clients', 'error'); }
    finally { setSaving(false); }
  };

  const setAllClientActions = (action: 'create' | 'update' | 'skip') => {
    setClientPreview((list) => list.map((r) => {
      if (!r.duplicate && action === 'update') return r;
      if (!r.duplicate && action === 'skip') return { ...r, action: 'create' };
      return { ...r, action: r.duplicate ? action : r.action };
    }));
  };

  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

  return (
    <div>
      <div className="page-header"><h1>Import de données</h1></div>
      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.45 }}>
          CSV / TSV (Excel → CSV). Clients : mapping des colonnes, validation, doublons (ICE / e-mail / nom), actions créer · mettre à jour · ignorer.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {([['clients', 'Clients'], ['ledger', 'Solde (écritures)'], ['bills', 'Factures d\'achat']] as const).map(([id, label]) => (
            <button key={id} type="button" className={mode === id ? '' : 'secondary'} onClick={() => {
              setMode(id); setPreview([]); setBillPreview([]); setClientPreview([]); setClientStats(null); setRawTable([]); setRawHeaders([]);
            }}>{label}</button>
          ))}
        </div>
        <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => onFile(e.target.files?.[0] || null)} />
      </div>

      {mode === 'clients' && rawHeaders.length > 0 && !clientPreview.length && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Mapping des colonnes</h2>
          <div className="grid grid-2" style={{ gap: 12 }}>
            {CLIENT_FIELDS.map((f) => (
              <div className="form-row" key={f.key}>
                <label>{f.label}</label>
                <select value={columnMap[f.key] ?? -1} onChange={(e) => setColumnMap({ ...columnMap, [f.key]: Number(e.target.value) })}>
                  <option value={-1}>— Non mappé —</option>
                  {rawHeaders.map((h, i) => (
                    <option key={i} value={i}>Col. {i + 1}: {h || '(vide)'}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="button" onClick={analyzeClients} disabled={saving}>{saving ? 'Analyse…' : 'Analyser & détecter les doublons'}</button>
          </div>
        </div>
      )}

      {mode === 'clients' && clientPreview.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 16, margin: 0 }}>Prévisualisation clients</h2>
              {clientStats && (
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 0' }}>
                  {clientStats.total} lignes · {clientStats.valid} valides · {clientStats.duplicates} doublons · {clientStats.invalid} invalides
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="secondary" style={{ fontSize: 12 }} onClick={() => setAllClientActions('skip')}>Doublons → ignorer</button>
              <button type="button" className="secondary" style={{ fontSize: 12 }} onClick={() => setAllClientActions('update')}>Doublons → mettre à jour</button>
              <button type="button" onClick={importClients} disabled={saving}>{saving ? 'Import…' : 'Importer la sélection'}</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th></th><th>#</th><th>Nom</th><th>ICE</th><th>E-mail</th><th>Tél.</th><th>Ville</th><th>Contrôle</th><th>Action</th></tr>
              </thead>
              <tbody>
                {clientPreview.map((r, i) => (
                  <tr key={i} style={{ opacity: r.valid ? 1 : 0.65 }}>
                    <td>
                      <input type="checkbox" checked={r.selected} disabled={!r.valid}
                        onChange={(e) => { const next = [...clientPreview]; next[i] = { ...r, selected: e.target.checked }; setClientPreview(next); }} />
                    </td>
                    <td>{r.row}</td>
                    <td><strong>{r.name || '—'}</strong></td>
                    <td style={{ fontSize: 12 }}>{r.ice || '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.email || '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.phone || '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.city || '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {!r.valid && <span style={{ color: 'var(--bad)' }}>{r.errors.join(', ')}</span>}
                      {r.valid && r.duplicate && <span style={{ color: '#8a6d1a' }}>Doublon ({r.duplicate.match_on}) : {r.duplicate.name}</span>}
                      {r.valid && !r.duplicate && <span style={{ color: 'var(--success, #2d5a2d)' }}>OK</span>}
                    </td>
                    <td>
                      <select value={r.action} disabled={!r.valid} style={{ fontSize: 12 }}
                        onChange={(e) => { const next = [...clientPreview]; next[i] = { ...r, action: e.target.value as ClientPreview['action'] }; setClientPreview(next); }}>
                        <option value="create">Créer</option>
                        <option value="update" disabled={!r.duplicate}>Mettre à jour</option>
                        <option value="skip">Ignorer</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'ledger' && preview.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16 }}>Prévisualisation solde</h2>
            <button type="button" onClick={importLedger} disabled={saving}>{saving ? '…' : 'Importer'}</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th></th><th>Date</th><th>Description</th><th>Type</th><th>Montant</th></tr></thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" checked={r.selected} onChange={(e) => { const next = [...preview]; next[i] = { ...r, selected: e.target.checked }; setPreview(next); }} /></td>
                    <td>{r.date}</td><td>{r.description}</td><td>{r.entry_type}</td><td>{fmt(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'bills' && billPreview.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16 }}>Prévisualisation factures d&apos;achat</h2>
            <button type="button" onClick={importBills} disabled={saving}>{saving ? '…' : 'Importer'}</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th></th><th>Fournisseur</th><th>N°</th><th>Date</th><th>Total</th></tr></thead>
              <tbody>
                {billPreview.map((r, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" checked={r.selected} onChange={(e) => { const next = [...billPreview]; next[i] = { ...r, selected: e.target.checked }; setBillPreview(next); }} /></td>
                    <td>{r.vendor_name}</td><td>{r.number || '—'}</td><td>{r.issue_date}</td><td>{fmt(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
