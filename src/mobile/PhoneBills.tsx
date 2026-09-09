/**
 * Native phone UI for purchase bills & reception (not desktop table embed).
 * Pattern: card list + empty state + large CTA (mobile ERP best practice).
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { friendlyError } from '../lib/errors';
import { statusFr } from '../lib/labels';
import NumberField from '../components/NumberField';
import { IconPackage } from '../components/Icons';

const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');

type Props = { onToast: (msg: string) => void };

export default function PhoneBills({ onToast }: Props) {
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [receiveBill, setReceiveBill] = useState<any>(null);
  const [receiveLines, setReceiveLines] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [locations, setLocations] = useState<any[]>([]);
  const [receiveLoc, setReceiveLoc] = useState(0);
  const [scanCode, setScanCode] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, loc] = await Promise.all([api.getBills(), api.getStockLocations()]);
      setBills((b as any).data || []);
      setLocations((loc as any).data || []);
    } catch (e: any) {
      onToast(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = bills.filter((b) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return String(b.number || '').toLowerCase().includes(q) || String(b.vendor_name || '').toLowerCase().includes(q);
  });

  const openReceive = async (b: any) => {
    try {
      const r: any = await api.getBillMatch(b.id);
      setReceiveBill(b);
      setReceiveLines(
        (r.data?.lines || []).map((l: any) => ({
          id: l.id,
          product_id: l.product_id,
          product_name: l.product_name || '—',
          sku: l.sku || '',
          barcode: l.barcode || '',
          ordered: Number(l.ordered || 0),
          received: Number(l.received || 0),
          add: 0, // start at 0 — scan or type to fill
        })),
      );
      setScanCode('');
      const def = (locations as any[]).find((x) => x.is_default);
      setReceiveLoc(def?.id || locations[0]?.id || 0);
    } catch (e: any) {
      onToast(friendlyError(e));
    }
  };

  const submitReceive = async () => {
    if (!receiveBill) return;
    setBusy(true);
    try {
      const items = receiveLines.filter((l) => l.add > 0).map((l) => ({ bill_item_id: l.id, qty_received: l.add }));
      if (!items.length) {
        onToast('Aucune quantité à recevoir');
        return;
      }
      const r: any = await api.receiveBill(receiveBill.id, {
        items,
        location_id: receiveLoc || undefined,
      });
      onToast(r.message || 'Réception enregistrée');
      setReceiveBill(null);
      load();
    } catch (e: any) {
      onToast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const applyScan = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const q = code.toLowerCase();
    setReceiveLines((prev) => {
      let idx = prev.findIndex(
        (l) =>
          (l.barcode && String(l.barcode).toLowerCase() === q) ||
          (l.sku && String(l.sku).toLowerCase() === q) ||
          (l.product_name && String(l.product_name).toLowerCase() === q),
      );
      if (idx < 0) {
        idx = prev.findIndex(
          (l) =>
            (l.barcode && String(l.barcode).toLowerCase().includes(q)) ||
            (l.sku && String(l.sku).toLowerCase().includes(q)) ||
            (l.product_name && String(l.product_name).toLowerCase().includes(q)),
        );
      }
      if (idx < 0) {
        queueMicrotask(() => onToast(`Code non trouvé sur cette facture : ${code}`));
        return prev;
      }
      const next = [...prev];
      const l = next[idx];
      const maxAdd = Math.max(0, l.ordered - l.received);
      next[idx] = { ...l, add: Math.min(maxAdd, Number(l.add || 0) + 1) };
      queueMicrotask(() => onToast(`+1 · ${l.product_name}`));
      return next;
    });
    setScanCode('');
  };

  if (receiveBill) {
    return (
      <div className="phone-panel">
        <button type="button" className="ph-back" onClick={() => setReceiveBill(null)}>← Retour</button>
        <h1 className="ph-title" style={{ fontSize: 22 }}>Réception</h1>
        <p className="ph-sub">{receiveBill.number} · {receiveBill.vendor_name}</p>

        <div className="ph-field">
          <label>Scan code-barres / SKU</label>
          <input
            className="ph-search"
            value={scanCode}
            placeholder="Scanner ou saisir puis Entrée"
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => setScanCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyScan(scanCode);
              }
            }}
            onBlur={() => {
              if (scanCode.trim().length >= 3) applyScan(scanCode);
            }}
          />
          <p className="ph-sub" style={{ marginTop: 4 }}>Chaque scan ajoute +1 à la ligne correspondante (plafond = reste à recevoir).</p>
        </div>

        <div className="ph-field">
          <label>Entrepôt de réception</label>
          <select value={receiveLoc || ''} onChange={(e) => setReceiveLoc(Number(e.target.value))}>
            <option value={0}>Par défaut</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
            ))}
          </select>
        </div>

        <div className="ph-card-list">
          {receiveLines.map((l, idx) => (
            <div key={l.id} className="ph-card">
              <div className="ph-card-title">{l.product_name}</div>
              <div className="ph-card-meta">Commandé {l.ordered} · Reçu {l.received}</div>
              <div className="ph-field" style={{ marginTop: 8, marginBottom: 0 }}>
                <label>À recevoir maintenant</label>
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
              </div>
            </div>
          ))}
        </div>

        <button type="button" className="ph-cta" style={{ marginTop: 16 }} disabled={busy} onClick={submitReceive}>
          <span className="ph-cta-text">
            <strong>{busy ? 'Enregistrement…' : 'Valider la réception'}</strong>
            <span>Stock mis à jour sur l’entrepôt choisi</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="phone-panel">
      <p className="ph-eyebrow">Achats</p>
      <h1 className="ph-title" style={{ fontSize: 24 }}>Factures d’achat</h1>
      <p className="ph-sub">Réceptionnez les livraisons et alimentez le stock par entrepôt.</p>

      <div className="ph-search-wrap">
        <input
          className="ph-search"
          placeholder="N° ou fournisseur…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading && <p className="ph-sub">Chargement…</p>}

      {!loading && !filtered.length && (
        <div className="ph-empty">
          <div className="ph-empty-ico" aria-hidden><IconPackage size={28} /></div>
          <h2>Aucune facture d’achat</h2>
          <p>Enregistrez un achat fournisseur sur le PC, puis validez la réception ici pour alimenter le stock.</p>
          <a className="ph-chip on" href="/?mode=pc#/bills">Créer sur PC</a>
        </div>
      )}

      <div className="ph-card-list">
        {filtered.map((b) => (
          <article key={b.id} className="ph-card">
            <div className="ph-card-row">
              <div>
                <div className="ph-card-title">{b.number}</div>
                <div className="ph-card-meta">{b.vendor_name}</div>
              </div>
              <span className="ph-badge">{statusFr(b.status)}</span>
            </div>
            <div className="ph-card-row" style={{ marginTop: 8 }}>
              <span className="ph-card-meta">{b.issue_date}</span>
              <strong>{fmt(b.total)} MAD</strong>
            </div>
            {b.status !== 'cancelled' && (
              <button type="button" className="ph-btn-block" onClick={() => openReceive(b)}>
                Réception / stock
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
