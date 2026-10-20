/**
 * Scan code-barres — same pipeline as the old phone terrain scan
 * (Quagga2 / html5-qrcode / ZXing via barcodeScan.ts).
 */
import { useEffect, useRef, useState } from 'react';
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

export default function Scan() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');
  const [hit, setHit] = useState<Hit | null>(null);
  const [unknown, setUnknown] = useState(false);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const stopRef = useRef<ScanStop | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

      <form
        className="scan-form"
        onSubmit={(e) => {
          e.preventDefault();
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
    </div>
  );
}
