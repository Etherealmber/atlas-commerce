/**
 * Scan code-barres — same pipeline as the old phone terrain scan
 * (Quagga2 / html5-qrcode / ZXing via barcodeScan.ts).
 *
 * Unknown code → popup proposing a *product creation request* (code + optional
 * photo/name, never a price — a PC user completes the product later).
 * Desktop (PC) also lists open requests with a "Créer produit" shortcut.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { canManageStock } from '../auth';
import {
  startBarcodeScan,
  decodeImageFile,
  preloadBarcodeScanner,
  type ScanStop,
} from '../lib/barcodeScan';

type Hit = {
  id: number;
  name?: string;
  sku?: string;
  barcode?: string;
  stock_quantity?: number;
  price?: number;
};

type ProductRequest = {
  id: number;
  code: string;
  name?: string;
  sku?: string;
  unit?: string;
  quantity?: number;
  category?: string;
  note?: string;
  photo_url?: string;
  status: string;
  created_by?: string;
  created_at?: string;
};

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const fn = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return narrow;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('Lecture du fichier impossible'));
    fr.readAsDataURL(file);
  });
}

const SCAN_UNITS = ['unité', 'pièce', 'kg', 'g', 'L', 'mL', 'm', 'carton', 'boîte', 'paquet', 'sachet'];

export default function Scan() {
  const nav = useNavigate();
  const narrow = useIsNarrow();
  const [q, setQ] = useState('');
  const [opMode, setOpMode] = useState<'vente' | 'receive' | 'transfer' | 'count'>('vente');
  const [opQty, setOpQty] = useState('1');
  const [opLot, setOpLot] = useState('');
  const [opExpiry, setOpExpiry] = useState('');
  const [opWh, setOpWh] = useState('');
  const [opWh2, setOpWh2] = useState('');
  const [opMsg, setOpMsg] = useState('');
  const [opErr, setOpErr] = useState('');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  useEffect(() => { api.getStockLocations().then((r: any) => setWarehouses(r?.data || [])).catch(() => {}); }, []);
  const runOp = async () => {
    setOpErr(''); setOpMsg(''); setBusy(true);
    try {
      const code = q.trim().toLowerCase();
      const pr: any = await api.getProducts();
      const prod = (pr?.data || []).find((x: any) => String(x.barcode || '').toLowerCase() === code || String(x.sku || '').toLowerCase() === code);
      if (!prod) { setOpErr('Code inconnu pour cette opération — scannez un produit existant.'); return; }
      const qty = Number(opQty);
      if (opMode === 'receive') {
        const r: any = await api.stockReceive({ product_id: prod.id, quantity: qty, location_id: opWh ? Number(opWh) : undefined, lot: opLot, expiry: opExpiry });
        setOpMsg(`Réception ✓ — stock ${prod.name} : ${r?.data?.stock_quantity ?? '?'}`);
      } else if (opMode === 'count') {
        const r: any = await api.stockCount({ product_id: prod.id, quantity: qty, location_id: opWh ? Number(opWh) : undefined });
        setOpMsg(`Inventaire ✓ — stock ${prod.name} : ${r?.data?.stock_quantity ?? qty}`);
      } else {
        await api.stockTransfer({ product_id: prod.id, quantity: qty, from_location_id: Number(opWh), to_location_id: Number(opWh2) });
        setOpMsg(`Transfert ✓ — ${prod.name}`);
      }
    } catch (e: any) {
      setOpErr(e?.message || 'Erreur opération');
    } finally {
      setBusy(false);
    }
  };

  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');
  const [hit, setHit] = useState<Hit | null>(null);
  const [unknown, setUnknown] = useState(false);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const stopRef = useRef<ScanStop | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Product-creation request (unknown barcode)
  const [reqOpen, setReqOpen] = useState(false);
  const [reqName, setReqName] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqPhoto, setReqPhoto] = useState(''); // data URL preview + payload
  const [reqSku, setReqSku] = useState('');
  const [reqUnit, setReqUnit] = useState('unité');
  const [reqQty, setReqQty] = useState('1');
  const [reqCat, setReqCat] = useState('');
  const [reqCats, setReqCats] = useState<string[]>([]);
  const [reqUnits, setReqUnits] = useState<string[]>(SCAN_UNITS);
  const [reqErrors, setReqErrors] = useState<{ name?: string; unit?: string; qty?: string }>({});
  const [reqBusy, setReqBusy] = useState(false);
  const [reqMsg, setReqMsg] = useState('');
  const [sent, setSent] = useState(false);
  const reqPhotoRef = useRef<HTMLInputElement | null>(null);
  const [requests, setRequests] = useState<ProductRequest[]>([]);

  useEffect(() => {
    if (!canManageStock()) nav('/', { replace: true });
  }, [nav]);

  useEffect(() => {
    preloadBarcodeScanner();
    return () => {
      try { stopRef.current?.(); } catch { /* */ }
      stopRef.current = null;
    };
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const r: any = await api.listProductRequests('open');
      setRequests((r?.data || []) as ProductRequest[]);
    } catch { /* silent — panel is best-effort */ }
  }, []);

  useEffect(() => {
    if (narrow) return; // mobile stays minimal
    void loadRequests();
  }, [narrow, loadRequests]);

  // Unknown code → open the request popup automatically
  useEffect(() => {
    if (unknown) {
      setReqOpen(true);
      setReqMsg('');
      setReqErrors({});
      setReqSku(q.trim());
      api
        .getUnits()
        .then((r: any) => {
          const list = (r?.data || []).map((u: any) => String(u.name || u.label || '')).filter(Boolean);
          setReqUnits(list.length ? list : SCAN_UNITS);
        })
        .catch(() => setReqUnits(SCAN_UNITS));
      api
        .getProducts({ fields: 'light', limit: 500 })
        .then((r: any) => {
          const cats = Array.from(
            new Set((r?.data || []).map((pp: any) => String(pp.category || '')).filter(Boolean)),
          ) as string[];
          setReqCats(cats);
        })
        .catch(() => {});
    }
  }, [unknown]);

  const stopCamera = () => {
    try { stopRef.current?.(); } catch { /* */ }
    stopRef.current = null;
    if (readerRef.current) readerRef.current.innerHTML = '';
    setScanning(false);
  };

  const resolveCode = async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    setBusy(true);
    setErr('');
    setHit(null);
    setUnknown(false);
    try {
      const res = await api.scanBarcode(c);
      const data = (res as any)?.data as Hit | undefined;
      if (data && data.id) {
        setHit(data);
        setQ(c);
      } else {
        setUnknown(true);
        setQ(c);
      }
    } catch (e: any) {
      if (e?.status === 404 || e?.code === 'NOT_FOUND') {
        setUnknown(true);
        setQ(c);
      } else {
        // fallback list search
        try {
          const r = await api.getProducts({ q: c, limit: 5 });
          const rows = ((r as any)?.data || []) as Hit[];
          const exact =
            rows.find(
              (p) =>
                String(p.barcode || '').toLowerCase() === c.toLowerCase() ||
                String(p.sku || '').toLowerCase() === c.toLowerCase(),
            ) || rows[0];
          if (exact) setHit(exact);
          else setUnknown(true);
          setQ(c);
        } catch {
          setErr(e?.message || 'Recherche impossible');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const startCamera = async () => {
    if (busy) return;
    setErr('');
    stopCamera();
    setScanning(true);
    // wait for reader div
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = readerRef.current;
    if (!el) {
      setErr('Zone caméra indisponible');
      setScanning(false);
      return;
    }
    try {
      const stop = await startBarcodeScan(el, (text) => {
        const t = String(text || '').trim();
        if (!t) return;
        stopCamera();
        void resolveCode(t);
      });
      stopRef.current = stop;
    } catch (e: any) {
      setScanning(false);
      setErr(e?.message || 'Caméra indisponible — autorisez l’accès ou saisissez le code.');
    }
  };

  const onPickImage = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const text = await decodeImageFile(file);
      if (!text) {
        setErr('Aucun code détecté dans l’image.');
      } else {
        await resolveCode(text);
      }
    } catch (e: any) {
      setErr(e?.message || 'Lecture image impossible');
    } finally {
      setBusy(false);
    }
  };

  const closeReqModal = () => {
    setReqOpen(false);
    setReqName('');
    setReqNote('');
    setReqPhoto('');
    setReqMsg('');
    setReqSku('');
    setReqUnit('unité');
    setReqQty('1');
    setReqCat('');
    setReqErrors({});
  };

  const submitRequest = async () => {
    if (!q.trim() || reqBusy) return;
    const errs: { name?: string; unit?: string; qty?: string } = {};
    if (!reqName.trim()) errs.name = 'Nom obligatoire';
    if (!reqUnit) errs.unit = 'Unité obligatoire';
    const qtyN = Number(String(reqQty).replace(',', '.'));
    if (!String(reqQty).trim() || !Number.isFinite(qtyN) || qtyN < 0) errs.qty = 'Quantité obligatoire (0 ou plus)';
    setReqErrors(errs);
    if (Object.keys(errs).length) return;
    setReqBusy(true);
    setReqMsg('');
    try {
      await api.createProductRequest({
        code: q.trim(),
        name: reqName.trim(),
        sku: reqSku.trim() || q.trim(),
        unit: reqUnit,
        quantity: qtyN,
        category: reqCat.trim() || undefined,
        note: reqNote.trim() || undefined,
        photo_data_url: reqPhoto || undefined,
      });
      closeReqModal();
      setUnknown(false);
      setErr('');
      setHit(null);
      setSent(true);
      void loadRequests();
    } catch (e: any) {
      setReqMsg(e?.message || 'Envoi impossible — réessayez');
    } finally {
      setBusy(false);
      setReqBusy(false);
    }
  };

  const createProductFromRequest = (r: ProductRequest) => {
    nav('/products', {
      state: {
        newWithBarcode: r.code,
        newWithName: r.name || '',
        newWithSku: r.sku || r.code,
        newWithUnit: r.unit || 'unité',
        newWithQuantity: Number(r.quantity || 0),
        newWithCategory: r.category || '',
      },
    });
  };

  const dismissRequest = async (r: ProductRequest) => {
    try {
      await api.closeProductRequest(r.id, { status: 'dismissed' });
      setRequests((rows) => rows.filter((x) => x.id !== r.id));
    } catch (e: any) {
      setErr(e?.message || 'Impossible de rejeter la demande');
    }
  };

  return (
    <div className="scan-page">
      <header className="scan-hero">
        <p className="scan-eyebrow">Scan</p>
        <h1 className="scan-title">Que scannez-vous&nbsp;?</h1>
        <p className="scan-lead">
          1) Ouvrez <strong>Caméra</strong> · 2) Placez le code dans le cadre · 3) Tenez stable 1&nbsp;s.
          Sinon : image ou saisie manuelle.
        </p>
      </header>

      {scanning ? (
        <div className="scan-cam-wrap">
          <div id="scan-reader" ref={readerRef} className="scan-reader" />
          <button type="button" className="scan-cam-stop" onClick={stopCamera}>
            Fermer la caméra
          </button>
        </div>
      ) : (
        <div className="scan-actions-row">
          <button type="button" className="scan-btn-primary" onClick={() => void startCamera()} disabled={busy}>
            Caméra
          </button>
          <button
            type="button"
            className="scan-btn-secondary"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            Image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              e.target.value = '';
              void onPickImage(f);
            }}
          />
        </div>
      )}

      <div className="scan-ops-chips" role="tablist" aria-label="Mode de scan">
        {([['vente', 'Vente'], ['receive', 'Réception'], ['transfer', 'Transfert'], ['count', 'Inventaire']] as const).map(([m, lbl]) => (
          <button key={m} type="button" className={`secondary${opMode === m ? ' is-active' : ''}`} onClick={() => { setOpMode(m); setOpErr(''); setOpMsg(''); }}>
            {lbl}
          </button>
        ))}
      </div>

      {opMode !== 'vente' && (
        <form
          className="scan-form scan-ops-form"
          onSubmit={(e) => { e.preventDefault(); void runOp(); }}
        >
          <div className="scan-row">
            <input className="scan-input" type="number" step="any" min="0" value={opQty} onChange={(e) => setOpQty(e.target.value)} placeholder="Quantité" aria-label="Quantité" />
            {opMode === 'receive' && (
              <>
                <input className="scan-input" value={opLot} onChange={(e) => setOpLot(e.target.value)} placeholder="Lot (optionnel)" aria-label="Lot" />
                <input className="scan-input" type="date" value={opExpiry} onChange={(e) => setOpExpiry(e.target.value)} aria-label="Expiration" />
              </>
            )}
          </div>
          {(opMode === 'receive' || opMode === 'count') && warehouses.length > 0 && (
            <select className="scan-input" value={opWh} onChange={(e) => setOpWh(e.target.value)} aria-label="Dépôt">
              <option value="">Dépôt principal</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          {opMode === 'transfer' && (
            <div className="scan-row">
              <select className="scan-input" value={opWh} onChange={(e) => setOpWh(e.target.value)} aria-label="Dépôt source">
                {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name} (source)</option>)}
              </select>
              <select className="scan-input" value={opWh2} onChange={(e) => setOpWh2(e.target.value)} aria-label="Dépôt destination">
                {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name} (dest.)</option>)}
              </select>
            </div>
          )}
          <button type="submit" className="scan-submit" disabled={busy}>{opMode === 'receive' ? 'Réceptionner' : opMode === 'transfer' ? 'Transférer' : 'Compter'}</button>
          {opErr ? <div className="scan-alert" role="alert">{opErr}</div> : null}
          {opMsg ? <div className="scan-alert scan-alert--ok" role="status">{opMsg}</div> : null}
        </form>
      )}

      <form
        className="scan-form"
        onSubmit={(e) => {
          e.preventDefault();
          setSent(false);
          void resolveCode(q);
        }}
      >
        <label className="scan-label" htmlFor="scan-code">
          Code-barres ou SKU
        </label>
        <div className="scan-row">
          <input
            id="scan-code"
            ref={inputRef}
            className="scan-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Scannez ou saisissez un code"
            autoComplete="off"
            enterKeyHint="search"
          />
          <button type="submit" className="scan-submit" disabled={busy}>
            {busy ? '…' : 'Chercher'}
          </button>
        </div>
      </form>

      {err ? (
        <div className="scan-alert" role="alert">
          {err}
        </div>
      ) : null}

      {sent && !err ? (
        <div className="scan-alert scan-alert--ok" role="status">
          Demande de création envoyée ✓ — un utilisateur PC complétera le produit (prix, etc.).
        </div>
      ) : null}

      {hit ? (
        <article className="scan-result">
          <h2>{hit.name || 'Produit'}</h2>
          <dl className="scan-meta">
            <div>
              <dt>SKU</dt>
              <dd>{hit.sku || '—'}</dd>
            </div>
            <div>
              <dt>Code-barres</dt>
              <dd>{hit.barcode || '—'}</dd>
            </div>
            <div>
              <dt>Stock</dt>
              <dd className="tabular">{hit.stock_quantity ?? '—'}</dd>
            </div>
            <div>
              <dt>Prix</dt>
              <dd className="tabular">{hit.price != null ? `${hit.price} MAD` : '—'}</dd>
            </div>
          </dl>
          <div className="scan-actions">
            <button type="button" className="secondary" onClick={() => nav('/products')}>
              Voir le stock
            </button>
            <button
              type="button"
              onClick={() => {
                setQ('');
                setHit(null);
                setUnknown(false);
                setSent(false);
                setErr('');
                inputRef.current?.focus();
              }}
            >
              Nouveau scan
            </button>
          </div>
        </article>
      ) : unknown ? (
        <div className="scan-alert scan-alert--muted" role="status">
          Code <strong>{q}</strong> inconnu — aucun produit correspondant.
        </div>
      ) : !scanning ? (
        <div className="scan-empty">
          <p>Le résultat du scan apparaîtra ici.</p>
        </div>
      ) : null}

      {/* ── Desktop (PC): open creation requests ── */}
      {!narrow && requests.length > 0 && (
        <section className="scan-requests" aria-label="Demandes de création">
          <h2 className="scan-requests-title">
            Demandes de création ({requests.length})
          </h2>
          <p className="scan-requests-lead">
            Envoyées depuis le scan (code inconnu). Créez le produit avec son prix, puis rejetez la demande.
          </p>
          <ul className="scan-requests-list">
            {requests.map((r) => (
              <li key={r.id} className="scan-requests-row">
                {r.photo_url ? (
                  <img className="scan-requests-photo" src={r.photo_url} alt="" loading="lazy" />
                ) : (
                  <span className="scan-requests-photo scan-requests-photo--none" aria-hidden />
                )}
                <div className="scan-requests-info">
                  <strong>{r.code}</strong>
                  {r.name ? <span>{r.name}</span> : null}
                  <em>
                    {r.created_by || '—'}
                    {r.created_at ? ` · ${String(r.created_at).replace('T', ' ').slice(0, 16)}` : ''}
                  </em>
                </div>
                <div className="scan-requests-actions">
                  <button type="button" onClick={() => createProductFromRequest(r)}>
                    Créer produit
                  </button>
                  <button type="button" className="secondary" onClick={() => void dismissRequest(r)}>
                    Rejeter
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Unknown code → creation request popup ── */}
      {reqOpen && (
        <div className="scan-req-bg" role="presentation" onClick={closeReqModal}>
          <div
            className="scan-req-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Demander la création du produit"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Produit introuvable</h2>
            <p className="scan-req-sub">
              Le code <strong>{q}</strong> n’existe pas encore. Envoyez une demande de création —
              le prix et le stock seront complétés sur PC.
            </p>
            <label className="scan-req-label" htmlFor="scan-req-barcode">Code-barres (automatique)</label>
            <input
              id="scan-req-barcode"
              className="scan-req-input"
              value={q}
              readOnly
              style={{ opacity: 0.75 }}
            />
            <label className="scan-req-label" htmlFor="scan-req-sku">SKU (automatique)</label>
            <input
              id="scan-req-sku"
              className="scan-req-input"
              value={reqSku}
              onChange={(e) => setReqSku(e.target.value)}
            />
            <label className="scan-req-label" htmlFor="scan-req-name">
              Nom du produit *
            </label>
            <input
              id="scan-req-name"
              className={`scan-req-input${reqErrors.name ? ' scan-req-input--err' : ''}`}
              value={reqName}
              onChange={(e) => { setReqName(e.target.value); setReqErrors((x) => ({ ...x, name: '' })); }}
              placeholder="Ex. Café moulu 250 g"
            />
            {reqErrors.name ? <span className="scan-req-err">{reqErrors.name}</span> : null}
            <div className="scan-req-grid">
              <div>
                <label className="scan-req-label" htmlFor="scan-req-unit">Unité *</label>
                <select
                  id="scan-req-unit"
                  className={`scan-req-input${reqErrors.unit ? ' scan-req-input--err' : ''}`}
                  value={reqUnit}
                  onChange={(e) => { setReqUnit(e.target.value); setReqErrors((x) => ({ ...x, unit: '' })); }}
                >
                  {reqUnits.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                {reqErrors.unit ? <span className="scan-req-err">{reqErrors.unit}</span> : null}
              </div>
              <div>
                <label className="scan-req-label" htmlFor="scan-req-qty">Quantité *</label>
                <input
                  id="scan-req-qty"
                  className={`scan-req-input${reqErrors.qty ? ' scan-req-input--err' : ''}`}
                  inputMode="decimal"
                  value={reqQty}
                  onChange={(e) => { setReqQty(e.target.value); setReqErrors((x) => ({ ...x, qty: '' })); }}
                  placeholder="0"
                />
                {reqErrors.qty ? <span className="scan-req-err">{reqErrors.qty}</span> : null}
              </div>
            </div>
            <label className="scan-req-label" htmlFor="scan-req-cat">Catégorie</label>
            <select
              id="scan-req-cat"
              className="scan-req-input"
              value={reqCat}
              onChange={(e) => setReqCat(e.target.value)}
            >
              <option value="">— choisir —</option>
              {reqCats.map((cc) => (
                <option key={cc} value={cc}>{cc}</option>
              ))}
            </select>
            <label className="scan-req-label" htmlFor="scan-req-photo">
              Photo (optionnel)
            </label>
            <div className="scan-req-photo-row">
              <button
                type="button"
                id="scan-req-photo"
                className="scan-req-photo-btn secondary"
                onClick={() => reqPhotoRef.current?.click()}
              >
                {reqPhoto ? 'Changer la photo' : 'Prendre / choisir une photo'}
              </button>
              {reqPhoto ? (
                <img className="scan-req-thumb" src={reqPhoto} alt="Aperçu de la photo" />
              ) : null}
            </div>
            <input
              ref={reqPhotoRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void readFileAsDataUrl(f)
                  .then((d) => setReqPhoto(d))
                  .catch(() => setReqMsg('Lecture de la photo impossible'));
              }}
            />
            <div className="scan-req-note">
              <label className="scan-req-label" htmlFor="scan-req-note">
                Note (optionnel)
              </label>
              <textarea
                id="scan-req-note"
                className="scan-req-input"
                rows={2}
                value={reqNote}
                onChange={(e) => setReqNote(e.target.value)}
                placeholder="Détails utiles pour la saisie PC…"
              />
            </div>
            {reqMsg ? (
              <p className="scan-req-error" role="alert">
                {reqMsg}
              </p>
            ) : null}
            <div className="scan-req-actions">
              <button type="button" onClick={() => void submitRequest()} disabled={reqBusy}>
                {reqBusy ? 'Envoi…' : 'Envoyer la demande'}
              </button>
              <button type="button" className="secondary" onClick={closeReqModal} disabled={reqBusy}>
                Plus tard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
