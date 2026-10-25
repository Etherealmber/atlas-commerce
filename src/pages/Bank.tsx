import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from '../components/DatePicker';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useUi } from '../components/AppDialogs';
import RefreshIconButton from '../components/RefreshIconButton';
import './bank/bank.css';
import TransactionMatchingSheet from '../components/erp/TransactionMatchingSheet';

type BankRow = { date: string; label: string; amount: number; raw?: string };
type MatchItem = {
  bank: BankRow;
  match?: any | null;
  confidence?: number;
  reason?: string;
  status?: 'matched' | 'unmatched' | 'pending';
};
type Rule = {
  id: string;
  field: 'label' | 'amount' | 'date';
  op: 'contains' | 'eq' | 'gt' | 'lt';
  value: string;
  action: 'category' | 'party' | 'ignore';
  actionValue: string;
};

type MobileTab = 'feed' | 'match' | 'import' | 'rules' | 'logs';
type DetailTab = 'exact' | 'suggest' | 'manual';
type WizardStep = 1 | 2 | 3 | 4;

function fmt(n: number) {
  return Math.round(Number(n || 0)).toLocaleString('fr-FR');
}

function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`bank-badge ${tone}`}>{children}</span>;
}

function parseCsvSync(text: string): BankRow[] {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: BankRow[] = [];
  for (const line of lines) {
    if (/^date/i.test(line) && /libell|label|montant|amount/i.test(line)) continue;
    const sep = line.includes(';') ? ';' : ',';
    const parts = line.split(sep).map((p) => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) continue;
    const dateRaw = parts[0];
    const label = parts.length >= 3 ? parts[1] : '';
    const amountStr = parts.length >= 3 ? parts[2] : parts[1];
    const amount = Number(String(amountStr).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(amount)) continue;
    let date = dateRaw;
    const m = dateRaw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      date = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    out.push({ date, label, amount, raw: line });
  }
  return out;
}

export default function Bank() {
  const { toast } = useUi();
  const [mobileTab, setMobileTab] = useState<MobileTab>('feed');
  const [detailTab, setDetailTab] = useState<DetailTab>('exact');
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState<BankRow[]>([]);
  const [items, setItems] = useState<MatchItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [windowDays, setWindowDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [parsePct, setParsePct] = useState(0);
  const [matchPct, setMatchPct] = useState(0);
  const [ledgerHealth, setLedgerHealth] = useState<any>(null);
  const [logs, setLogs] = useState<{ at: string; msg: string; tone?: string }[]>([]);
  const [sheet, setSheet] = useState<'import' | 'rules' | 'logs' | null>(null);
  const [matchSheetOpen, setMatchSheetOpen] = useState(false);
  const [matchSel, setMatchSel] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardStep>(1);
  const [mapDate, setMapDate] = useState(0);
  const [mapLabel, setMapLabel] = useState(1);
  const [mapAmount, setMapAmount] = useState(2);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [rules, setRules] = useState<Rule[]>(() => {
    try {
      const raw = localStorage.getItem('atlas_bank_rules');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [ruleDraft, setRuleDraft] = useState<Rule>({
    id: '',
    field: 'label',
    op: 'contains',
    value: '',
    action: 'category',
    actionValue: '',
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const workerParse = useRef<Worker | null>(null);
  const workerMatch = useRef<Worker | null>(null);

  const log = useCallback((msg: string, tone = 'muted') => {
    setLogs((prev) => [{ at: new Date().toLocaleTimeString('fr-FR'), msg, tone }, ...prev].slice(0, 80));
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const r = await api.getLedgerReconcile();
      setLedgerHealth(r.data);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    void loadHealth();
    return () => {
      workerParse.current?.terminate();
      workerMatch.current?.terminate();
    };
  }, [loadHealth]);

  useEffect(() => {
    try {
      localStorage.setItem('atlas_bank_rules', JSON.stringify(rules));
    } catch { /* */ }
  }, [rules]);

  const pushParsed = (list: BankRow[]) => {
    setRows(list);
    setItems(list.map((bank) => ({ bank, match: null, status: 'unmatched' as const })));
    setSelected(0);
    log(`${list.length} ligne(s) importée(s)`, 'info');
  };

  const parseInWorker = (text: string) => {
    setParsePct(0);
    setBusy(true);
    try {
      workerParse.current?.terminate();
      const blob = new Blob(
        [
          `self.onmessage=function(e){var t=String(e.data.csv||'').replace(/^\\uFEFF/,'').split(/\\r?\\n/).map(function(l){return l.trim()}).filter(Boolean);var out=[];for(var i=0;i<t.length;i++){var line=t[i];if(/^date/i.test(line)&&/libell|label|montant/i.test(line))continue;var sep=line.indexOf(';')>=0?';':',';var p=line.split(sep).map(function(x){return x.trim().replace(/^"|"$/g,'')});if(p.length<2)continue;var date=p[0],label=p.length>=3?p[1]:'',as=p.length>=3?p[2]:p[1];var amount=Number(String(as).replace(/\\s/g,'').replace(',','.'));if(!isFinite(amount))continue;var m=date.match(/^(\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{2,4})$/);if(m){var y=m[3].length===2?'20'+m[3]:m[3];date=y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0')}out.push({date:date,label:label,amount:amount,raw:line});if(i%100===0)self.postMessage({type:'progress',done:i,total:t.length})}self.postMessage({type:'done',rows:out})}`,
        ],
        { type: 'application/javascript' },
      );
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      workerParse.current = w;
      w.onmessage = (ev) => {
        const d = ev.data;
        if (d.type === 'progress') {
          setParsePct(d.total ? Math.round((d.done / d.total) * 100) : 0);
        } else if (d.type === 'done') {
          pushParsed(d.rows || []);
          setParsePct(100);
          setBusy(false);
          setWizard(3);
          URL.revokeObjectURL(url);
          toast(`${(d.rows || []).length} lignes`, 'success');
        }
      };
      w.onerror = () => {
        pushParsed(parseCsvSync(text));
        setBusy(false);
      };
      w.postMessage({ csv: text });
    } catch {
      pushParsed(parseCsvSync(text));
      setBusy(false);
    }
  };

  const onPickFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
    const first = text.split(/\r?\n/).filter(Boolean)[0] || '';
    const sep = first.includes(';') ? ';' : ',';
    const headers = first.split(sep).map((h) => h.trim());
    setPreviewHeaders(headers.length ? headers : ['Col 1', 'Col 2', 'Col 3']);
    const body = text.split(/\r?\n/).filter(Boolean).slice(0, 8).map((l) => l.split(sep).map((c) => c.trim()));
    setPreviewRows(body);
    setWizard(2);
    setSheet('import');
    log(`Fichier « ${file.name} » chargé`, 'info');
  };

  const applyMappingAndParse = () => {
    // Remap columns from csv using indices
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    const remapped: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const sep = lines[i].includes(';') ? ';' : ',';
      const p = lines[i].split(sep).map((x) => x.trim());
      if (i === 0 && /date|libell|montant/i.test(lines[i])) continue;
      const d = p[mapDate] ?? '';
      const l = p[mapLabel] ?? '';
      const a = p[mapAmount] ?? '';
      remapped.push(`${d};${l};${a}`);
    }
    const joined = remapped.join('\n');
    setCsvText(joined);
    parseInWorker(joined);
  };

  const runServerMatch = async () => {
    const payload = csvText.trim() || rows.map((r) => `${r.date};${r.label};${r.amount}`).join('\n');
    if (!payload.trim()) {
      toast('Importez un relevé d’abord', 'error');
      return;
    }
    setBusy(true);
    setMatchPct(10);
    try {
      const r: any = await api.reconcileBankCsv(payload, { date_window_days: windowDays });
      const matches = (r.data?.matches || []) as any[];
      if (matches.length) {
        setItems(
          matches.map((m) => ({
            bank: m.bank || { date: m.date, label: m.label, amount: m.amount },
            match: m.match || m.atlas || null,
            confidence: m.confidence ?? m.score,
            reason: m.reason || m.rule,
            status: m.match || m.atlas ? 'matched' : 'unmatched',
          })),
        );
      } else if (r.data) {
        // fallback structure
        const unmatched = r.data.unmatched || [];
        setItems((prev) => {
          if (!prev.length && rows.length) {
            return rows.map((bank) => ({ bank, match: null, status: 'unmatched' as const }));
          }
          return prev.map((it) => {
            const hit = unmatched.find(
              (u: any) => u.date === it.bank.date && Math.abs(Number(u.amount) - it.bank.amount) < 0.02,
            );
            return hit ? { ...it, status: 'unmatched' as const } : it;
          });
        });
      }
      setMatchPct(100);
      log(r.message || `Rapprochement serveur · ${r.data?.matched ?? '?'} match(s)`, 'ok');
      toast(r.message || 'Rapprochement terminé', 'success');
      void loadHealth();
      setMobileTab('match');
      setWizard(4);
    } catch (e: any) {
      toast(e?.message || 'Échec', 'error');
      log(e?.message || 'Échec matching', 'bad');
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    let list = items;
    if (filter === 'matched') list = list.filter((i) => i.status === 'matched' || i.match);
    if (filter === 'unmatched') list = list.filter((i) => !i.match);
    if (from) list = list.filter((i) => String(i.bank.date) >= from);
    if (to) list = list.filter((i) => String(i.bank.date) <= to);
    return list;
  }, [items, filter, from, to]);

  const current = filtered[selected] || null;

  const stats = useMemo(() => {
    const matched = items.filter((i) => i.match).length;
    const sumIn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const sumOut = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
    return {
      lines: items.length || rows.length,
      matched,
      unmatched: (items.length || rows.length) - matched,
      sumIn,
      sumOut,
      net: sumIn + sumOut,
    };
  }, [items, rows]);

  const candidates = useMemo(() => {
    if (!current) return { exact: [], suggest: [] };
    if (current.match) {
      return { exact: [current.match], suggest: [] };
    }
    return { exact: [], suggest: [] };
  }, [current]);

  const saveRule = () => {
    if (!ruleDraft.value.trim()) {
      toast('Valeur de condition requise', 'error');
      return;
    }
    const id = ruleDraft.id || `r_${Date.now()}`;
    const next = [...rules.filter((r) => r.id !== id), { ...ruleDraft, id }];
    setRules(next);
    setRuleDraft({ id: '', field: 'label', op: 'contains', value: '', action: 'category', actionValue: '' });
    log('Règle enregistrée (locale)', 'ok');
    toast('Règle sauvegardée', 'success');
  };

  const unmatch = (idx: number) => {
    const target = filtered[idx];
    if (!target) return;
    setItems((prev) =>
      prev.map((it) =>
        it.bank.date === target.bank.date && it.bank.amount === target.bank.amount && it.bank.label === target.bank.label
          ? { ...it, match: null, status: 'unmatched', confidence: 0, reason: '' }
          : it,
      ),
    );
    log('Match retiré', 'warn');
  };

  /* ——— subviews ——— */
  const FeedPane = (
    <div className="bank-pane">
      <div className="bank-pane-head">
        <span>Transactions relevé ({filtered.length})</span>
        <Badge tone={filter === 'unmatched' ? 'warn' : 'muted'}>{filter}</Badge>
      </div>
      <div className="bank-feed">
        {filtered.length === 0 && (
          <p style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>
            Aucune ligne. Utilisez l’onglet Import ou le bouton Importer.
          </p>
        )}
        {filtered.map((it, i) => {
          const amt = Number(it.bank.amount || 0);
          const active = i === selected;
          return (
            <button
              key={`${it.bank.date}-${i}-${it.bank.amount}`}
              type="button"
              className={`bank-row${active ? ' active' : ''}`}
              onClick={() => {
                setSelected(i);
                setMobileTab('match');
                if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
                  setMatchSheetOpen(true);
                  setMatchSel(filtered[i]?.match ? 'm0' : null);
                }
              }}
            >
              <span className="date">{it.bank.date || '—'}</span>
              <span className="desc">
                <span className="t">{it.bank.label || '—'}</span>
                <span style={{ marginTop: 4, display: 'inline-block' }}>
                  {it.match ? <Badge tone="ok">Matché</Badge> : <Badge tone="warn">Non rapproché</Badge>}
                </span>
              </span>
              <span className={`amt ${amt >= 0 ? 'credit' : 'debit'}`}>{fmt(amt)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const MatchPane = (
    <div className="bank-pane">
      <div className="bank-pane-head">
        <span>Espace matching</span>
        {current?.confidence != null && current.match && (
          <Badge tone="info">{current.confidence}%</Badge>
        )}
      </div>
      <div className="bank-detail">
        <div className="bank-tabs">
          {(
            [
              ['exact', 'Exact'],
              ['suggest', 'Suggestions'],
              ['manual', 'Manuel'],
            ] as const
          ).map(([k, lab]) => (
            <button
              key={k}
              type="button"
              className={`bank-tab${detailTab === k ? ' active' : ''}`}
              onClick={() => setDetailTab(k)}
            >
              {lab}
            </button>
          ))}
        </div>

        {!current && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sélectionnez une transaction.</p>}

        {current && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Ligne banque</div>
              <div style={{ fontWeight: 650, fontSize: 15 }}>{current.bank.label || '—'}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {current.bank.date} · <strong>{fmt(current.bank.amount)} MAD</strong>
              </div>
            </div>

            {detailTab === 'exact' && (
              <div>
                {candidates.exact.length === 0 && !current.match && (
                  <p style={{ fontSize: 13, color: 'var(--muted)' }}>Aucun match exact — essayez Suggestions ou le matching serveur.</p>
                )}
                {(current.match ? [current.match] : candidates.exact).map((m: any, idx: number) => (
                  <div key={idx} className="card" style={{ marginBottom: 8 }}>
                    <Badge tone="ok">Candidat</Badge>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
                      <div><strong>{m.kind || m.type || m.category || 'écriture Atlas'}</strong></div>
                      {m.invoice_number && <div>Facture {m.invoice_number}</div>}
                      {m.client_name && <div>{m.client_name}</div>}
                      {m.amount != null && <div>{fmt(Number(m.amount))} MAD</div>}
                      {current.reason && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Règle : {current.reason}</div>}
                    </div>
                    <div className="bank-actions-row">
                      <button type="button" className="secondary" onClick={() => unmatch(selected)}>Unmatch</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {detailTab === 'suggest' && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Lancez le rapprochement serveur pour remplir les suggestions (montant + date + libellé).
                </p>
                <div className="bank-actions-row">
                  <button type="button" disabled={busy} onClick={() => void runServerMatch()}>
                    {busy ? `Matching… ${matchPct}%` : 'Matcher maintenant'}
                  </button>
                </div>
                {matchPct > 0 && matchPct < 100 && (
                  <div className="bank-progress"><i style={{ width: `${matchPct}%` }} /></div>
                )}
              </div>
            )}

            {detailTab === 'manual' && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
                  Créer / ajuster l’écriture dans Solde, puis relancer le matching.
                </p>
                <div className="bank-actions-row">
                  <Link to="/balance"><button type="button">Ouvrir Solde</button></Link>
                  <button type="button" className="secondary" onClick={() => setSheet('rules')}>Règles</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const ImportBody = (
    <div>
      <div className="bank-wizard-steps">
        {[1, 2, 3, 4].map((s) => (
          <span key={s} className={wizard === s ? 'on' : ''}>
            {s === 1 ? '1 · Fichier' : s === 2 ? '2 · Colonnes' : s === 3 ? '3 · Aperçu' : '4 · Poster'}
          </span>
        ))}
      </div>

      {wizard === 1 && (
        <>
          <div
            className="bank-drop"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
            onDragLeave={(e) => e.currentTarget.classList.remove('over')}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('over');
              const f = e.dataTransfer.files?.[0];
              if (f) void onPickFile(f);
            }}
          >
            <div>Glissez un CSV ici</div>
            <button type="button" className="secondary" style={{ minHeight: 48 }} onClick={() => fileRef.current?.click()}>
              Choisir un fichier
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickFile(f);
                e.target.value = '';
              }}
            />
          </div>
          <textarea
            rows={4}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={'2026-08-01;Virement FA-2026-0001;12000\n2026-08-02;Loyer;-3500'}
            style={{ width: '100%', marginTop: 12, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
          />
          <div className="bank-actions-row">
            <button
              type="button"
              disabled={!csvText.trim()}
              onClick={() => {
                const sep = csvText.includes(';') ? ';' : ',';
                const first = csvText.split(/\r?\n/).filter(Boolean)[0] || '';
                setPreviewHeaders(first.split(sep).map((h) => h.trim()));
                setPreviewRows(
                  csvText.split(/\r?\n/).filter(Boolean).slice(0, 8).map((l) => l.split(sep).map((c) => c.trim())),
                );
                setWizard(2);
              }}
            >
              Continuer → colonnes
            </button>
          </div>
        </>
      )}

      {wizard === 2 && (
        <>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>Associez chaque colonne Atlas à votre fichier.</p>
          <div className="bank-map-grid">
            <div>
              <label>Date</label>
              <select value={mapDate} onChange={(e) => setMapDate(Number(e.target.value))}>
                {previewHeaders.map((h, i) => (
                  <option key={i} value={i}>{h || `Col ${i + 1}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Libellé</label>
              <select value={mapLabel} onChange={(e) => setMapLabel(Number(e.target.value))}>
                {previewHeaders.map((h, i) => (
                  <option key={i} value={i}>{h || `Col ${i + 1}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Montant</label>
              <select value={mapAmount} onChange={(e) => setMapAmount(Number(e.target.value))}>
                {previewHeaders.map((h, i) => (
                  <option key={i} value={i}>{h || `Col ${i + 1}`}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="bank-actions-row">
            <button type="button" className="secondary" onClick={() => setWizard(1)}>Retour</button>
            <button type="button" onClick={applyMappingAndParse} disabled={busy}>
              {busy ? `Parse ${parsePct}%` : 'Parser & aperçu'}
            </button>
          </div>
          {busy && <div className="bank-progress"><i style={{ width: `${parsePct}%` }} /></div>}
        </>
      )}

      {wizard >= 3 && (
        <>
          <div className="bank-preview-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Libellé</th>
                  <th>Montant</th>
                </tr>
              </thead>
              <tbody>
                {(rows.length ? rows : parseCsvSync(csvText)).slice(0, 25).map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td>
                    <td>{r.label}</td>
                    <td>{fmt(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bank-actions-row">
            <button type="button" className="secondary" onClick={() => setWizard(2)}>Colonnes</button>
            <button type="button" disabled={busy || !(rows.length || csvText.trim())} onClick={() => void runServerMatch()}>
              {busy ? 'Matching…' : 'Lancer rapprochement'}
            </button>
          </div>
        </>
      )}
    </div>
  );

  const RulesBody = (
    <div>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        Règles locales (navigateur). Le matching serveur reste la source principale.
      </p>
      <div className="bank-map-grid">
        <div>
          <label>Champ</label>
          <select
            value={ruleDraft.field}
            onChange={(e) => setRuleDraft((d) => ({ ...d, field: e.target.value as Rule['field'] }))}
          >
            <option value="label">Libellé</option>
            <option value="amount">Montant</option>
            <option value="date">Date</option>
          </select>
        </div>
        <div>
          <label>Opérateur</label>
          <select
            value={ruleDraft.op}
            onChange={(e) => setRuleDraft((d) => ({ ...d, op: e.target.value as Rule['op'] }))}
          >
            <option value="contains">contient</option>
            <option value="eq">égal</option>
            <option value="gt">supérieur</option>
            <option value="lt">inférieur</option>
          </select>
        </div>
        <div>
          <label>Valeur</label>
          <input value={ruleDraft.value} onChange={(e) => setRuleDraft((d) => ({ ...d, value: e.target.value }))} placeholder="ex. LOYER" />
        </div>
        <div>
          <label>Action</label>
          <select
            value={ruleDraft.action}
            onChange={(e) => setRuleDraft((d) => ({ ...d, action: e.target.value as Rule['action'] }))}
          >
            <option value="category">Catégoriser</option>
            <option value="party">Assigner tiers</option>
            <option value="ignore">Ignorer</option>
          </select>
        </div>
        <div>
          <label>Valeur action</label>
          <input
            value={ruleDraft.actionValue}
            onChange={(e) => setRuleDraft((d) => ({ ...d, actionValue: e.target.value }))}
            placeholder="ex. Loyer"
          />
        </div>
      </div>
      <div className="bank-actions-row">
        <button type="button" onClick={saveRule}>Enregistrer la règle</button>
      </div>
      <ul style={{ marginTop: 14, paddingLeft: 18, fontSize: 13 }}>
        {rules.length === 0 && <li style={{ color: 'var(--muted)' }}>Aucune règle</li>}
        {rules.map((r) => (
          <li key={r.id} style={{ marginBottom: 6 }}>
            Si <strong>{r.field}</strong> {r.op} « {r.value} » → {r.action} {r.actionValue}
            <button
              type="button"
              className="secondary"
              style={{ marginLeft: 8, minHeight: 36, padding: '4px 10px', fontSize: 12 }}
              onClick={() => setRules((prev) => prev.filter((x) => x.id !== r.id))}
            >
              Supprimer
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const LogsBody = (
    <div>
      {logs.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Aucune activité pour cette session.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {logs.map((l, i) => (
          <li key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)', fontSize: 11, marginRight: 8 }}>{l.at}</span>
            {l.msg}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="page bank-hub">
      <div className="bank-top">
        <div style={{ flex: 1, minWidth: 180 }}>
          <h1>Banque & rapprochement</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Hub type ERPNext Banking — desktop split-pane, mobile onglets, workers hors UI.
          </p>
        </div>
        <RefreshIconButton onClick={() => { void loadHealth(); log('Rafraîchi', 'info'); }} />
        <button type="button" className="secondary bank-desktop-only" style={{ minHeight: 44 }} onClick={() => setSheet('logs')}>
          Journal
        </button>
        <button type="button" className="secondary" style={{ minHeight: 44 }} onClick={() => { setSheet('import'); setWizard(1); }}>
          Importer
        </button>
        <button type="button" disabled={busy} style={{ minHeight: 44 }} onClick={() => void runServerMatch()}>
          {busy ? '…' : 'Rapprocher'}
        </button>
      </div>

      <div className="bank-metrics">
        {[
          { lbl: 'Lignes', val: stats.lines },
          { lbl: 'Matchés', val: stats.matched },
          { lbl: 'Ouverts', val: stats.unmatched },
          { lbl: 'Crédits', val: `+${fmt(stats.sumIn)}` },
          { lbl: 'Débits', val: fmt(stats.sumOut) },
          { lbl: 'Net', val: fmt(stats.net) },
        ].map((m) => (
          <div key={m.lbl} className="bank-metric">
            <div className="lbl">{m.lbl}</div>
            <div className="val">{m.val}</div>
          </div>
        ))}
      </div>

      {ledgerHealth?.summary && (
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          <Badge tone={ledgerHealth.summary.ok ? 'ok' : 'warn'}>
            {ledgerHealth.summary.ok ? 'Ledger cohérent' : 'Écarts ledger'}
          </Badge>
          <span style={{ marginLeft: 8, fontSize: 13 }}>{ledgerHealth.summary.message}</span>
        </div>
      )}

      <div className="bank-toolbar">
        <div>
          <label>Du</label>
          <DatePicker value={from} onChange={setFrom} />
        </div>
        <div>
          <label>Au</label>
          <DatePicker value={to} onChange={setTo} />
        </div>
        <div>
          <label>± jours</label>
          <input
            type="number"
            min={0}
            max={60}
            value={windowDays}
            onChange={(e) => setWindowDays(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
            style={{ width: 72 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'matched', 'unmatched'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`bank-pill${filter === f ? ' active' : ''}`}
              onClick={() => { setFilter(f); setSelected(0); }}
            >
              {f === 'all' ? 'Tous' : f === 'matched' ? 'Matchés' : 'Ouverts'}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop dual pane */}
      <div className="bank-split bank-desktop-only">
        {FeedPane}
        {MatchPane}
      </div>

      {/* Mobile stacked by tab */}
      <div className="bank-mobile-only">
        {mobileTab === 'feed' && FeedPane}
        {mobileTab === 'match' && MatchPane}
        {mobileTab === 'import' && <div className="card">{ImportBody}</div>}
        {mobileTab === 'rules' && <div className="card">{RulesBody}</div>}
        {mobileTab === 'logs' && <div className="card">{LogsBody}</div>}
      </div>

      <nav className="bank-mobile-nav" aria-label="Banque mobile">
        {(
          [
            ['feed', 'Transactions'],
            ['match', 'Match'],
            ['import', 'Import'],
            ['rules', 'Règles'],
            ['logs', 'Journal'],
          ] as const
        ).map(([id, lab]) => (
          <button
            key={id}
            type="button"
            className={mobileTab === id ? 'active' : ''}
            onClick={() => {
              setMobileTab(id);
              if (id === 'import') setWizard(1);
            }}
          >
            {lab}
          </button>
        ))}
      </nav>

      {matchSheetOpen && current && (
        <TransactionMatchingSheet
          isOpen={matchSheetOpen}
          onClose={() => setMatchSheetOpen(false)}
          transaction={{
            date: current.bank.date,
            description: current.bank.label,
            amount: current.bank.amount,
            type: current.bank.amount >= 0 ? 'deposit' : 'withdrawal',
          }}
          candidates={
            current.match
              ? [{
                  id: 'm0',
                  title: String(current.match.kind || current.match.type || current.match.category || 'Écriture Atlas'),
                  subtitle: [current.match.invoice_number, current.match.client_name].filter(Boolean).join(' · '),
                  amount: current.match.amount != null ? Number(current.match.amount) : undefined,
                  score: current.confidence,
                }]
              : []
          }
          selectedId={matchSel}
          onSelect={setMatchSel}
          onConfirm={() => { setMatchSheetOpen(false); }}
        />
      )}
      {sheet && (
        <div className="bank-sheet-backdrop" onClick={() => setSheet(null)} role="presentation">
          <div className="bank-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3>
                {sheet === 'import' ? 'Import relevé' : sheet === 'rules' ? 'Règles' : 'Journal'}
              </h3>
              <button type="button" className="secondary" style={{ minHeight: 44 }} onClick={() => setSheet(null)}>
                Fermer
              </button>
            </div>
            {sheet === 'import' && ImportBody}
            {sheet === 'rules' && RulesBody}
            {sheet === 'logs' && LogsBody}
          </div>
        </div>
      )}
    </div>
  );
}
