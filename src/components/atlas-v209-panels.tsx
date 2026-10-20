/** v209 panels — alertes stock/documents (M5), références fournisseur (L7), kits & assemblages (L6). */
import { useEffect, useState } from 'react';
import { api } from '../api';
import RefreshIconButton from './RefreshIconButton';

const DEFAULT_ALERTS = [
  { key: 'stock_low', label: 'Stock sous le seuil', threshold: 0 },
  { key: 'stock_out', label: 'Rupture de stock', threshold: 0 },
  { key: 'invoice_overdue', label: 'Facture échue', threshold: 0 },
  { key: 'quote_stale', label: 'Devis sans réponse (jours)', threshold: 7 },
];

export function AlertsPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [busyKey, setBusyKey] = useState('');
  const load = () => {
    api.getAlertSettings().then((r: any) => {
      const have = r?.data || [];
      const merged = DEFAULT_ALERTS.map((d) => ({ ...d, enabled: 1, ...(have.find((h: any) => h.key === d.key) || {}) }));
      setRows(merged);
    }).catch(() => setRows(DEFAULT_ALERTS.map((d) => ({ ...d, enabled: 1 }))));
  };
  useEffect(load, []);
  const save = async (row: any, patch: any) => {
    setBusyKey(row.key);
    try {
      await api.saveAlertSetting({ ...row, ...patch });
      setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, ...patch } : r)));
    } finally {
      setBusyKey('');
    }
  };
  return (
    <div className="ac-panel" style={{ marginTop: 16 }}>
      <div className="ac-panel-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>Alertes stock & documents</strong>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>déclenchent les webhooks (événement atlas.alert)</span>
        <span style={{ marginLeft: 'auto' }}><RefreshIconButton onClick={() => load()} /></span>
      </div>
      <div className="table-wrap">
        <table className="data-dense">
          <thead><tr><th>Alerte</th><th>Seuil</th><th style={{ width: 90 }}>Active</th><th style={{ width: 90 }}>Test</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td>
                  <input
                    type="number"
                    style={{ width: 80 }}
                    value={r.threshold}
                    disabled={busyKey === r.key}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, threshold: Number(e.target.value) } : x)))}
                    onBlur={(e) => void save(r, { threshold: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input type="checkbox" checked={!!r.enabled} disabled={busyKey === r.key} onChange={(e) => void save(r, { enabled: e.target.checked ? 1 : 0 })} />
                </td>
                <td>
                  <button type="button" className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} disabled={busyKey === r.key} onClick={() => void api.saveAlertSetting({ ...r, test: true }).then(() => alert('Test envoyé aux webhooks.'))}>
                    Tester
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SupplierPartsPanel() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ product_id: '', supplier_sku: '', q1: '10', p1: '', q2: '50', p2: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.getVendors().then((r: any) => setVendors(r?.data || [])).catch(() => {});
    api.getProducts().then((r: any) => setProducts(r?.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!vendorId) { setRows([]); return; }
    api.getVendorParts(Number(vendorId)).then((r: any) => setRows(r?.data || [])).catch(() => setRows([]));
  }, [vendorId]);
  const add = async () => {
    const breaks = [
      { qty: Number(form.q1) || 10, price: Number(form.p1) || 0 },
      { qty: Number(form.q2) || 50, price: Number(form.p2) || 0 },
    ].filter((b) => b.price > 0);
    await api.addVendorPart({ vendor_id: Number(vendorId), product_id: Number(form.product_id), supplier_sku: form.supplier_sku, price_breaks: breaks });
    setMsg('Référence ajoutée ✓');
    setTimeout(() => setMsg(''), 3000);
    const r: any = await api.getVendorParts(Number(vendorId));
    setRows(r?.data || []);
  };
  return (
    <div className="ac-panel" style={{ marginTop: 16 }}>
      <div className="ac-panel-head"><strong>Références fournisseur & tarifs dégressifs</strong></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 0' }}>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="Fournisseur" style={{ width: 'auto' }}>
          <option value="">— choisir un fournisseur —</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {vendorId && (
          <>
            <select value={form.product_id} onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))} aria-label="Produit" style={{ width: 'auto' }}>
              <option value="">— produit —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input placeholder="SKU fournisseur" value={form.supplier_sku} onChange={(e) => setForm((f) => ({ ...f, supplier_sku: e.target.value }))} style={{ width: 140 }} />
            <input placeholder="Qté 1" type="number" value={form.q1} onChange={(e) => setForm((f) => ({ ...f, q1: e.target.value }))} style={{ width: 70 }} />
            <input placeholder="Prix 1" type="number" value={form.p1} onChange={(e) => setForm((f) => ({ ...f, p1: e.target.value }))} style={{ width: 90 }} />
            <input placeholder="Qté 2" type="number" value={form.q2} onChange={(e) => setForm((f) => ({ ...f, q2: e.target.value }))} style={{ width: 70 }} />
            <input placeholder="Prix 2" type="number" value={form.p2} onChange={(e) => setForm((f) => ({ ...f, p2: e.target.value }))} style={{ width: 90 }} />
            <button type="button" onClick={() => void add()} disabled={!form.product_id}>Ajouter</button>
          </>
        )}
      </div>
      {msg && <p style={{ color: 'var(--ok, #16a34a)', fontSize: 12 }}>{msg}</p>}
      {vendorId && (
        <div className="table-wrap">
          <table className="data-dense">
            <thead><tr><th>Produit</th><th>SKU fournisseur</th><th>Paliers</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{products.find((p) => p.id === r.product_id)?.name || `#${r.product_id}`}</td>
                  <td>{r.supplier_sku}</td>
                  <td>{(JSON.parse(r.price_breaks || '[]') as any[]).map((b) => `${b.qty}× → ${b.price} MAD`).join(' · ') || '—'}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>Aucune référence pour ce fournisseur.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function KitsPanel() {
  const [kits, setKits] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', product_id: '', c1: '', q1: '1', c2: '', q2: '1' });
  const [msg, setMsg] = useState('');
  const load = () => {
    api.getKits().then((r: any) => setKits(r?.data || [])).catch(() => {});
    api.getProducts().then((r: any) => setProducts(r?.data || [])).catch(() => {});
  };
  useEffect(load, []);
  const create = async () => {
    const items = [
      { product_id: Number(form.c1), quantity: Number(form.q1) || 1 },
      form.c2 ? { product_id: Number(form.c2), quantity: Number(form.q2) || 1 } : null,
    ].filter(Boolean) as any[];
    if (!form.name || !form.product_id || !items.length) return;
    await api.createKit({ name: form.name, product_id: Number(form.product_id), items });
    setMsg('Kit créé ✓');
    setTimeout(() => setMsg(''), 3000);
    load();
  };
  const assemble = async (id: number) => {
    try {
      await api.assembleKit(id, 1);
      setMsg('Assemblage ✓ (composants décrémentés, kit incrémenté)');
    } catch (e: any) {
      setMsg(`Impossible : ${e?.message || 'stock insuffisant'}`);
    }
    setTimeout(() => setMsg(''), 4000);
    load();
  };
  return (
    <div className="ac-panel" style={{ marginTop: 16 }}>
      <div className="ac-panel-head"><strong>Kits & assemblages (BOM)</strong></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 0' }}>
        <input placeholder="Nom du kit" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={{ width: 150 }} />
        <select value={form.product_id} onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))} aria-label="Produit fini" style={{ width: 'auto' }}>
          <option value="">— produit fini —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={form.c1} onChange={(e) => setForm((f) => ({ ...f, c1: e.target.value }))} aria-label="Composant 1" style={{ width: 'auto' }}>
          <option value="">— composant 1 —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="number" value={form.q1} onChange={(e) => setForm((f) => ({ ...f, q1: e.target.value }))} style={{ width: 60 }} aria-label="Qté 1" />
        <select value={form.c2} onChange={(e) => setForm((f) => ({ ...f, c2: e.target.value }))} aria-label="Composant 2" style={{ width: 'auto' }}>
          <option value="">— composant 2 —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="number" value={form.q2} onChange={(e) => setForm((f) => ({ ...f, q2: e.target.value }))} style={{ width: 60 }} aria-label="Qté 2" />
        <button type="button" onClick={() => void create()}>Créer le kit</button>
      </div>
      {msg && <p style={{ fontSize: 12, color: 'var(--muted)' }}>{msg}</p>}
      <div className="table-wrap">
        <table className="data-dense">
          <thead><tr><th>Kit</th><th>Produit fini</th><th>Composants</th><th style={{ width: 110 }}>Assembler</th></tr></thead>
          <tbody>
            {kits.map((k) => (
              <tr key={k.id}>
                <td><strong>{k.name}</strong></td>
                <td>{products.find((p) => p.id === k.product_id)?.name || `#${k.product_id}`}</td>
                <td>{(k.items || []).map((it: any) => `${products.find((p) => p.id === it.product_id)?.name || '#' + it.product_id} ×${it.quantity}`).join(' + ') || '—'}</td>
                <td><button type="button" className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => void assemble(k.id)}>Assembler ×1</button></td>
              </tr>
            ))}
            {!kits.length && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Aucun kit — créez le premier ci-dessus.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
